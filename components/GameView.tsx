"use client";

/**
 * The game screen: board, status, and move history.
 *
 * Moves are submitted to the server, which is the authority on turn order and
 * the game record. This component optimistically shows the resulting position
 * while the request is in flight, and reconciles with whatever the server
 * returns.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Board from "./Board";
import SetupPanel from "./SetupPanel";
import { useSetupSlots } from "./useSetupSlots";
import { useBotTurn } from "./useBotTurn";
import ChatPanel from "./ChatPanel";
import { useAutoRefresh } from "./useAutoRefresh";
import {
  applyMove,
  applySetup,
  homeRow,
  moveToNotation,
  type BoardState,
  type Move,
  type Player,
} from "@/lib/game/board";
import { describeThinkTime, describeTimeControl, relativeTime } from "@/lib/format";

interface GameSummary {
  id: string;
  status: "open" | "setup" | "active" | "finished";
  turn: Player;
  result: number | null;
  resultReason: string | null;
  /** The winner of a goal-ended game is offering the loser a rewind. */
  takebackOffered: boolean;
  ply: number;
  moveSeconds: number;
  deadlineAt: number | null;
  /** Bumped by every action, so polling can detect changes that leave ply alone. */
  updatedAt: number;
  player1Name: string | null;
  player2Name: string | null;
  hasPlayer2: boolean;
  /** The engine's side, when one of the players is a bot. Null for human games. */
  botSide: Player | null;
  botName: string | null;
  /** Who the reserved seat is for, when this open game is a challenge. */
  invitedName: string | null;
  /** The viewer is the one this challenge is for. */
  youAreInvited: boolean;
}

interface HistoryEntry {
  ply: number;
  player: Player;
  kind: "setup" | "move";
  move: Move;
  boardAfter: BoardState;
  /** How long the player took, in milliseconds. */
  thinkMs: number | null;
}

interface Props {
  game: GameSummary;
  board: BoardState;
  /** The position the game began from, as recorded on the game. */
  startBoard: BoardState;
  history: HistoryEntry[];
  viewerSide: Player | null;
  signedIn: boolean;
}

export default function GameView({
  game,
  board,
  startBoard,
  history,
  viewerSide,
  signedIn,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<BoardState | null>(null);
  // null means "live"; a ply number means the user is reviewing history.
  const [viewingPly, setViewingPly] = useState<number | null>(null);
  // A live preview of the arrangement while a player places their pieces.
  const [setupPreview, setSetupPreview] = useState<(number | null)[] | null>(null);
  // A move chosen but not yet sent. Dragging a piece stages the move and shows
  // the position it would produce; nothing reaches the server until Submit.
  // A move is hard to take back once played, and dragging is easy to misjudge,
  // so the confirmation step is worth the extra click — it also matches how
  // placing pieces already works.
  const [staged, setStaged] = useState<Move | null>(null);
  // The move just sent, held until the server's version of the board arrives.
  // Without it the board shows the new position while the arrow still points at
  // the *previous* move — which, in a bot game, is the engine's. That flash of a
  // wrong arrow is worse than none.
  const [justPlayed, setJustPlayed] = useState<Move | null>(null);
  // You sit at the bottom by default; the flip control lets you look from the
  // other side, which also moves the player bars to match.
  const [flipped, setFlipped] = useState(viewerSide === -1);

  // A new server position supersedes any optimistic one, and any move staged
  // against the old position — which is no longer a move that makes sense.
  //
  // Keyed on the board's CONTENTS, not the array, because the page re-renders
  // with a fresh array whenever the server component does. Keying on identity
  // would throw away a move the player had staged but not yet sent, every time
  // anything refreshed.
  const boardKey = board.join("");
  useEffect(() => {
    setOptimistic(null);
    setStaged(null);
    setJustPlayed(null);
    // The arrangement preview goes here too, not the moment it is submitted.
    // It is the only thing drawing the pieces a player has just placed, so
    // clearing it on submit emptied the home row until the server answered —
    // a visible reset of the board on the way to the same position.
    setSetupPreview(null);
  }, [boardKey]);

  const liveBoard = optimistic ?? board;

  // viewingPly null = live position; 0 = the starting position; n = after move n.
  //
  // The starting position comes from the game record rather than being assumed,
  // so a game that began from a non-standard setup replays correctly.
  const displayBoard = useMemo(() => {
    if (viewingPly === null) return liveBoard;
    if (viewingPly === 0) return startBoard;
    return history.find((h) => h.ply === viewingPly)?.boardAfter ?? liveBoard;
  }, [viewingPly, liveBoard, startBoard, history]);

  // While arranging, show the pieces on the board as they are chosen.
  const previewBoard = useMemo(() => {
    if (!setupPreview || viewerSide === null) return null;
    const filled = setupPreview.map((p) => p ?? 0);
    return applySetup(displayBoard, viewerSide, filled);
  }, [setupPreview, viewerSide, displayBoard]);

  /**
   * Explore: a sandbox copied from whatever position was being looked at.
   *
   * Purely client state. Nothing here is a move — pieces are pushed around
   * freely, both sides', to test an idea, then Done drops back to the game
   * exactly as it was. Entering from a reviewed position works, which is the
   * point: step back to where it went wrong and try the other line.
   */
  const [exploreBoard, setExploreBoard] = useState<BoardState | null>(null);
  const exploreBase = useRef<BoardState | null>(null);
  const exploring = exploreBoard !== null;

  // A staged move is shown as though played, so the player judges the position
  // they would actually get. Not applied while reviewing history, where the
  // board is showing some earlier position instead.
  const stagedBoard = useMemo(() => {
    if (!staged || viewingPly !== null) return null;
    return applyMove(displayBoard, staged);
  }, [staged, viewingPly, displayBoard]);

  const shownBoard = exploreBoard ?? previewBoard ?? stagedBoard ?? displayBoard;

  const reviewing = viewingPly !== null && viewingPly !== game.ply;

  // The table's private chat: the two players, nobody else. A bot game has
  // nobody to talk to at all, so it gets no column; a spectator on a human
  // game sees the panel's shell saying so — an absent column reads as a bug,
  // a present one that explains itself reads as a rule.
  const chatColumn = game.botSide === null;
  const canChat = chatColumn && viewerSide !== null && signedIn;

  const enterExplore = useCallback(() => {
    // Captured from the board on screen — including a reviewed position.
    exploreBase.current = shownBoard;
    setExploreBoard(shownBoard);
  }, [shownBoard]);

  const exploreMove = useCallback((mv: Move) => {
    setExploreBoard((b) => (b ? applyMove(b, mv) : b));
  }, []);

  const resetExplore = useCallback(() => {
    if (exploreBase.current) setExploreBoard(exploreBase.current);
  }, []);

  const exitExplore = useCallback(() => {
    exploreBase.current = null;
    setExploreBoard(null);
  }, []);

  const yourTurn =
    game.status === "active" && viewerSide !== null && viewerSide === game.turn;
  const canMove = yourTurn && !pending && !reviewing && staged === null && !exploring;

  // The engine's turn. Only a participant's browser runs the search — a
  // spectator watching the game should not be made to do the work, and the
  // server refuses them anyway.
  const isBotTurn =
    game.botSide !== null &&
    viewerSide !== null &&
    game.turn === game.botSide &&
    (game.status === "active" || game.status === "setup");

  const onBotMoved = useCallback(() => {
    setOptimistic(null);
    router.refresh();
  }, [router]);

  const bot = useBotTurn(game.id, isBotTurn, game.ply, onBotMoved);
  // For the status panel, "your turn" covers placing as well as moving.
  const yourTurnOrPlacement =
    viewerSide !== null &&
    viewerSide === game.turn &&
    (game.status === "active" || game.status === "setup");

  // Placing pieces: the board starts empty and each player arranges their home
  // row before play begins.
  const inSetup = game.status === "setup";
  const yourPlacement = inSetup && viewerSide !== null && viewerSide === game.turn;

  // The home row being built. Held here rather than inside SetupPanel because
  // the arrangement is made in two places — the panel's tray and the board —
  // and both need the same six slots.
  const setup = useSetupSlots(setSetupPreview);

  // Two different things, drawn two different ways.
  //
  // `highlight` rings squares — only the home row, while a player is placing.
  // `shownMove` is drawn as arrows: the move being staged, the one being
  // reviewed, or the last one played. A setup ply is six ring counts rather
  // than board indices, so it is never drawn as a move.
  const lastPlayed = history.length ? history[history.length - 1] : null;
  const reviewed = reviewing ? history.find((h) => h.ply === viewingPly) : null;

  /**
   * The ply to jump to for "the start of the game".
   *
   * The last setup ply, not ply 0. Ply 0 is the empty board before anyone has
   * placed anything, which is not a position a player thinks of as the start —
   * it is the state before the game had one. What they mean is both home rows
   * down and nobody having moved yet.
   *
   * Null while setup is still in progress, when there is no such position yet.
   */
  const openingPly = useMemo(() => {
    const setups = history.filter((h) => h.kind === "setup");
    return setups.length === 2 ? setups[setups.length - 1].ply : null;
  }, [history]);

  const highlight = yourPlacement ? homeRow(viewerSide!) : [];

  const shownMove: Move =
    staged && viewingPly === null
      ? staged
      : reviewing
        ? (reviewed && reviewed.kind === "move" ? reviewed.move : [])
        : // A move of our own that the server has not confirmed yet. The board
          // is already showing its result, so the arrow must match it.
          justPlayed && viewingPly === null
          ? justPlayed
          : lastPlayed && lastPlayed.kind === "move"
            ? lastPlayed.move
            : [];

  /**
   * What the board should play as motion.
   *
   * Your own moves never animate — you just made them, and the board already
   * showed the result while you were staging. What animates is what you did
   * not do yourself: the opponent's move arriving (the effect below), and
   * history as you navigate it (goToPly).
   */
  const [anim, setAnim] = useState<{
    key: string;
    move: Move;
    reverse?: boolean;
    speed?: number;
  } | null>(null);

  // The opponent's move, when it lands. A LAYOUT effect, deliberately: a
  // plain effect runs after the browser paints, so the new position — arrows
  // and all — was visible for a frame before the animation request landed and
  // pulled the piece back to its starting square. Layout effects run between
  // commit and paint, so the request, the hidden arrows and the offset piece
  // all reach the screen together.
  useLayoutEffect(() => {
    if (reviewing || staged || justPlayed) return;
    if (!lastPlayed || lastPlayed.kind !== "move") return;
    if (viewerSide !== null && lastPlayed.player === viewerSide) return;
    setAnim({ key: `p${game.ply}`, move: lastPlayed.move });
  }, [reviewing, staged, justPlayed, lastPlayed, viewerSide, game.ply]);

  /**
   * A replay run in progress: walking viewingPly one step at a time toward a
   * target, so a jump across many plies animates every move on the way.
   *
   * Each step lands on a real intermediate position and plays that one move —
   * there is no faked composite. The run is a timer rather than a chain of
   * animation callbacks so a step that has nothing to animate (a setup ply)
   * costs one tick rather than stalling the walk.
   */
  const run = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walkTarget = useRef(0);
  const walking = useRef(false);
  // Mirrors `walking` for rendering: mid-walk the arrows are hidden outright,
  // or every step would flash its own pair in passing. They return with the
  // final position, once its animation lands.
  const [isWalking, setIsWalking] = useState(false);
  const stopRun = useCallback(() => {
    if (run.current !== null) clearTimeout(run.current);
    run.current = null;
    walking.current = false;
    setIsWalking(false);
  }, []);
  useEffect(() => stopRun, [stopRun]);

  /**
   * How long to hold each replay step, by how many plies are still to come.
   *
   * Every move is played — a jump never skips, it accelerates. The curve is
   * 1/r^1.5, which converges: however long the run, the waits sum to under
   * about two seconds, most of it spent on the last few moves. Deep in a jump
   * the steps overlap into a continuous blur; the run then eases out and the
   * landing move plays at full length. Skipping the middle was tried instead
   * and rejected — the point is a game played very fast, not a cut.
   */
  const tickFor = (remaining: number) =>
    Math.min(480, Math.max(28, 520 / Math.pow(remaining, 1.5)));

  /**
   * Every way of moving through history funnels through here.
   *
   * Navigation RETARGETS the walk rather than restarting it. There is one walk
   * at a time, stepping from wherever it has got to toward walkTarget; a key
   * pressed while it runs just moves the target, and the pacing responds on
   * its own because it is computed from the remaining distance each tick. So
   * leaning on an arrow key stretches one walk rather than piling up separate
   * animations — the board simply takes the path to wherever you have pointed
   * it, and pointing somewhere nearer while it travels turns it around.
   */
  const goToPly = useCallback(
    (target: number | null) => {
      // The sandbox sits on top of whatever was shown; navigating under it
      // would change nothing visible and desynchronise the exit. The base ref
      // doubles as the flag so this callback needs no state in its closure.
      if (exploreBase.current !== null) return;
      walkTarget.current = target ?? game.ply;
      if (walking.current) return; // the running walk picks the new target up
      const moveAt = (ply: number): Move | null => {
        const h = history.find((x) => x.ply === ply);
        return h && h.kind === "move" ? h.move : null;
      };

      // The walk owns its position in this closure. It must NOT live inside a
      // setViewingPly updater: updaters have to be pure, React invokes them
      // twice in dev to enforce it, and side effects there ran every step
      // twice — the walk skipped plies and animations trampled each other.
      let cur = viewingPly ?? game.ply;
      if (cur === walkTarget.current) return;
      walking.current = true;
      setIsWalking(true);

      const step = () => {
        const tgt = walkTarget.current;
        if (cur === tgt) {
          stopRun();
          return;
        }
        const next = cur + Math.sign(tgt - cur);
        const remaining = Math.abs(tgt - cur);
        // The animation should fill its slot: scale it to the tick, full
        // length for the landing move. The board's own duration floor lets
        // deep-blur steps overlap slightly, which is what makes the run read
        // as continuous motion rather than a slideshow.
        const pace = remaining === 1 ? 1 : Math.max(0.1, tickFor(remaining) / 520);
        const reverse = next < cur;
        // Backwards, the move being animated is the one just undone — the
        // move AT the square we left, not the one we land on.
        const mv = moveAt(reverse ? cur : next);
        cur = next;

        setViewingPly(next === game.ply ? null : next);
        if (mv) {
          setAnim({
            key: `h${next}:${reverse ? "r" : "f"}`,
            move: mv,
            reverse,
            speed: pace,
          });
        }
        if (cur === walkTarget.current) {
          stopRun();
          return;
        }
        run.current = setTimeout(step, tickFor(Math.abs(walkTarget.current - cur)));
      };

      step();
    },
    [game.ply, history, viewingPly, stopRun],
  );

  /** Choose a move without sending it. Replaces any move already staged. */
  const stage = useCallback((mv: Move) => {
    setError(null);
    setStaged(mv);
  }, []);

  /** Take back a staged move and go back to choosing. */
  const resetStaged = useCallback(() => {
    setError(null);
    setStaged(null);
  }, []);

  const submit = useCallback(
    async (mv: Move) => {
      setError(null);
      setPending(true);
      setStaged(null);
      setJustPlayed(mv);
      setOptimistic(applyMove(liveBoard, mv));
      try {
        const res = await fetch(`/api/games/${game.id}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ move: mv }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          // Both of these have to go back, not just the board. `justPlayed`
          // draws the arrows, and it is otherwise cleared only when a new
          // server position arrives — which a refused move never produces, so
          // the arrows for a move that never happened stayed on screen until
          // the page was reloaded.
          setOptimistic(null);
          setJustPlayed(null);
          setError(body.error ?? "The server rejected that move.");
        } else {
          router.refresh();
        }
      } catch {
        setOptimistic(null);
        setJustPlayed(null);
        setError("Could not reach the server.");
      } finally {
        setPending(false);
      }
    },
    [game.id, liveBoard, router],
  );

  const submitSetupArrangement = useCallback(
    async (arrangement: number[]) => {
      setError(null);
      setPending(true);
      try {
        const res = await fetch(`/api/games/${game.id}/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ arrangement }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "The server rejected that placement.");
        } else {
          router.refresh();
        }
      } catch {
        setError("Could not reach the server.");
      } finally {
        setPending(false);
      }
    },
    [game.id, router],
  );

  /**
   * Whether the player to move can hand the last move back.
   *
   * Against a person that returns the opponent's move to them; against the
   * engine it takes back your own move (with the bot's reply on top). The
   * server re-checks all of this — the condition here only decides whether
   * the button is worth showing.
   */
  const canGiveBack =
    game.status === "active" &&
    game.botSide !== null &&
    viewerSide !== null &&
    viewerSide === game.turn &&
    history.length > 1 &&
    history[history.length - 1].kind === "move" &&
    history[history.length - 1].player !== viewerSide &&
    history[history.length - 2].kind === "move" &&
    history[history.length - 2].player === viewerSide;

  const giveBack = useCallback(async () => {
    if (!confirm("Take back your last move and the engine's reply?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/games/${game.id}/undo`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not take that back.");
      } else {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }, [game.id, game.botSide, router]);

  /**
   * The same opponent again. Against the engine the game starts at once;
   * against a person this creates a challenge they accept from their
   * dashboard, and lands you on the new game's page to wait.
   */
  const playAgain = useCallback(async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/games/${game.id}/rematch`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? "Could not start a new game.");
        return;
      }
      router.push(`/game/${body.id}`);
    } finally {
      setPending(false);
    }
  }, [game.id, router]);

  /** Answer a challenge from its own page: sit down, or turn it down. */
  const answerChallenge = useCallback(
    async (accept: boolean) => {
      if (!accept && !confirm("Decline this challenge? It will be removed.")) return;
      setPending(true);
      try {
        const res = await fetch(
          `/api/games/${game.id}/${accept ? "join" : "decline"}`,
          { method: "POST" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Could not answer the challenge.");
          return;
        }
        if (accept) router.refresh();
        else router.push("/dashboard");
      } finally {
        setPending(false);
      }
    },
    [game.id, router],
  );

  /** The takeback conversation: op is offer, accept or decline. */
  const takeback = useCallback(
    async (op: "offer" | "accept" | "decline") => {
      if (op === "offer" && !confirm("Offer to let them take their last move back?"))
        return;
      setPending(true);
      try {
        const res = await fetch(`/api/games/${game.id}/takeback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Could not do that.");
          return;
        }
        router.refresh();
      } finally {
        setPending(false);
      }
    },
    [game.id, router],
  );

  /** Withdraw an open table before anyone joins. The game is deleted. */
  const cancel = useCallback(async () => {
    if (!confirm("Cancel this game? It will be removed.")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/games/${game.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not cancel.");
        return;
      }
      router.push("/games");
    } finally {
      setPending(false);
    }
  }, [game.id, router]);

  /**
   * A slow clock for everything that depends on wall time — the deadline
   * line, and whether an expired clock has armed the timeout claim. Thirty
   * seconds is plenty against deadlines measured in days.
   */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * The opponent's clock has run out and the win is there to take. Armed,
   * never automatic — the server enforces the same rule.
   */
  const canClaim =
    game.status === "active" &&
    viewerSide !== null &&
    viewerSide !== game.turn &&
    game.deadlineAt !== null &&
    game.deadlineAt * 1000 < nowTick;

  const claim = useCallback(async () => {
    if (!confirm("End the game and take the win on time?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/games/${game.id}/claim`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not claim.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }, [game.id, router]);

  /**
   * The big verdict, shown once per game per browser.
   *
   * A game ending is easy to miss — the board just stops. So the first time a
   * finished game is seen, the result takes the middle of the board and has
   * to be dismissed; after that the status panel is enough. localStorage
   * remembers the dismissal, and failing storage means showing it again,
   * which errs the right way.
   */
  const [splash, setSplash] = useState(false);
  // Keyed on the ply as well as the game: a takeback can revive a finished
  // game, and its SECOND ending deserves its own splash — the ply differs
  // once the ending is replayed, while a plain game key would stay dismissed.
  const splashKey = `result-seen:${game.id}:${game.ply}`;
  useEffect(() => {
    if (game.status !== "finished" || viewerSide === null) return;
    try {
      if (!localStorage.getItem(splashKey)) setSplash(true);
    } catch {
      setSplash(true);
    }
  }, [game.status, viewerSide, splashKey]);

  const dismissSplash = useCallback(() => {
    setSplash(false);
    try {
      localStorage.setItem(splashKey, "1");
    } catch {
      /* shown again next time; fine */
    }
  }, [splashKey]);

  /**
   * Walk away during setup. Distinct from resigning: nothing has happened yet,
   * so the game is deleted and no result is recorded for either player.
   */
  const abandon = useCallback(async () => {
    if (!confirm("Abandon this game? It will be removed, with no result for anyone."))
      return;
    setPending(true);
    try {
      const res = await fetch(`/api/games/${game.id}/abandon`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not abandon.");
        return;
      }
      router.push("/dashboard");
    } finally {
      setPending(false);
    }
  }, [game.id, router]);

  const resign = useCallback(async () => {
    if (!confirm("Resign this game?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/games/${game.id}/resign`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not resign.");
      } else {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }, [game.id, router]);

  // Watch for the opponent to act.
  //
  // Polling, not a websocket: correspondence moves arrive minutes or days
  // apart, so holding a connection open per viewer would cost far more than it
  // saves. The probe is about fifty bytes and only a real change refreshes.
  //
  // Every five seconds while the tab is being looked at; nothing while it is
  // hidden, and nothing once the game is over.
  //
  // Deliberately paused while the player has a move staged or in flight: a
  // refresh would replace the board under them, and discard the move they were
  // about to send.
  useAutoRefresh(
    `/api/games/${game.id}/version`,
    [game.ply, game.status, game.updatedAt].join(":"),
    {
      // A finished human game keeps listening: a takeback can arrive, be
      // answered, and bring the game back to life under both players.
      enabled:
        (game.status === "active" ||
          game.status === "setup" ||
          (game.status === "finished" && game.botSide === null)) &&
        !pending &&
        staged === null,
    },
  );

  // Arrow keys step through history, as the desktop versions did.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Steps extend from the walk's target, not from the ply on screen —
      // the screen lags a running walk, and stepping from it would pin the
      // target one ahead of the display forever instead of building distance.
      const base = walking.current ? walkTarget.current : (viewingPly ?? game.ply);
      if (e.key === "ArrowLeft") {
        goToPly(Math.max(0, base - 1));
      } else if (e.key === "ArrowRight") {
        if (base < game.ply) goToPly(Math.min(game.ply, base + 1));
      } else if (e.key === "ArrowUp") {
        goToPly(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game.ply, viewingPly, goToPly]);

  // Which side sits at the bottom of the screen.
  //
  // `flipped` rotates the board to player 2's perspective, which puts player 2
  // nearest the viewer — so flipped means player 2 is at the bottom. Since
  // `flipped` defaults to true for player 2, each player sees themselves at the
  // bottom, and a spectator sees player 1 there.
  const bottomSide: Player = flipped ? -1 : 1;
  const topSide: Player = flipped ? 1 : -1;
  const seat = (side: Player) => ({
    name: side === 1 ? game.player1Name : game.player2Name,
    side,
    toMove: game.status === "active" && game.turn === side,
    isYou: viewerSide === side,
  });

  return (
    <div className={chatColumn ? "grid-2 game-grid" : "grid-2 game-grid no-chat"}>
      {chatColumn && (
        <aside className="chat-rail">
          {canChat ? (
            <ChatPanel gameId={game.id} title="Table talk" canPost />
          ) : (
            <div className="panel chat-panel">
              <h2>Table talk</h2>
              <p className="muted" style={{ margin: 0 }}>
                The table talk is private to the players.
                {signedIn ? "" : " Sign in to chat in your own games."}
              </p>
            </div>
          )}
        </aside>
      )}
      <div>
        <PlayerBar {...seat(topSide)} />

        <div className={reviewing ? "board-wrap reviewing" : "board-wrap"}>
          <Board
            board={shownBoard}
            interactive={canMove || exploring}
            flipped={flipped}
            onMove={exploring ? exploreMove : stage}
            highlight={highlight}
            lastMove={isWalking || exploring ? [] : shownMove}
            free={exploring}
            // Marks legal destinations while dragging. A convenience only —
            // the server validates every move regardless. Passing undefined
            // rather than null when there is no viewer keeps the hint off for
            // spectators, who have no side to move for.
            player={viewerSide ?? undefined}
            setupSide={yourPlacement ? viewerSide! : undefined}
            onSetupSquare={setup.placeAt}
            setupRemaining={setup.remaining}
            animate={exploring ? null : anim}
            onSetupDrop={setup.dropAt}
            onSetupMove={setup.moveSlot}
          />
          {/* Explore, review and the staged move all speak from the same
              banner in the same spot — the pill over the board's lower edge.
              One place where the current mode explains itself and offers its
              controls. */}
          {splash && game.status === "finished" && viewerSide !== null && (
            <div className="result-splash" role="alertdialog" aria-live="assertive">
              <div
                className={
                  game.result === 0
                    ? "result-card"
                    : game.result === viewerSide
                      ? "result-card won"
                      : "result-card lost"
                }
              >
                <div className="result-word">
                  {game.result === 0
                    ? "Drawn"
                    : game.result === viewerSide
                      ? "You won"
                      : "You lost"}
                </div>
                <div className="muted">
                  {game.resultReason === "resign"
                    ? "by resignation"
                    : game.resultReason === "timeout"
                      ? "on time"
                      : "at the goal"}
                </div>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 14 }}
                  onClick={dismissSplash}
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {exploring && (
            <div className="review-banner">
              <span>Exploring — will not affect the game</span>
              <button className="btn" onClick={resetExplore}>
                Reset
              </button>
              <button className="btn btn-primary" onClick={exitExplore}>
                Done
              </button>
            </div>
          )}
          {/* The staged move's buttons, floated over the board's empty lower
              band — where the setup tray sits before play. The move itself is
              already drawn as an arrow; repeating its notation said nothing
              the board was not saying better. */}
          {staged && viewingPly === null && !exploring && (
            <div className="review-banner">
              <span>Not sent yet</span>
              <button
                className="btn btn-primary"
                onClick={() => submit(staged)}
                disabled={pending}
              >
                {pending ? "…" : "Submit move"}
              </button>
              <button className="btn" onClick={resetStaged} disabled={pending}>
                Reset
              </button>
            </div>
          )}
          {!exploring && reviewing && (
            <div className="review-banner">
              <span>
                {viewingPly === 0
                  ? "Empty board"
                  : describePly(history, viewingPly!, game.ply)}{" "}
                — you cannot play from here
              </span>
              <button className="btn btn-primary" onClick={() => goToPly(null)}>
                Back to live
              </button>
            </div>
          )}
        </div>

        <PlayerBar {...seat(bottomSide)} />

      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="panel">
          <h2>Tools</h2>
          <div className="row">
            <button className="btn" onClick={() => setFlipped((f) => !f)}>
              Flip board
            </button>
            {(game.status === "active" || game.status === "finished") && !exploring && (
              <button
                className="btn"
                onClick={enterExplore}
                title="Push pieces around freely to test an idea, then come back"
              >
                Explore
              </button>
            )}
            <span className="control-divider" aria-hidden="true" />
            <button
              className="btn"
              onClick={() => goToPly(openingPly)}
              disabled={openingPly === null || viewingPly === openingPly}
              title="Both home rows placed, before the first move"
            >
              Opening
            </button>
            <button
              className="btn"
              onClick={() => goToPly(null)}
              disabled={!reviewing}
            >
              Latest
            </button>
          </div>
          <p className="hint" style={{ margin: "10px 0 0" }}>
            {reviewing
              ? `Reviewing move ${viewingPly} of ${game.ply}`
              : "← → to review history"}
          </p>
          {error && <p className="error" style={{ margin: "10px 0 0" }}>{error}</p>}
        </div>
        {yourPlacement && (
          <SetupPanel
            side={viewerSide!}
            pending={pending}
            error={error}
            setup={setup}
            onSubmit={submitSetupArrangement}
          />
        )}

        {(bot.thinking || bot.error) && (
          <div className="panel">
            <h2>{bot.botName ?? game.botName ?? "The engine"}</h2>
            {bot.thinking ? (
              <>
                <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
                  Thinking… <strong>{bot.elapsed.toFixed(1)}s</strong>
                </p>
                <p className="hint" style={{ marginTop: 8 }}>
                  The engine is running in this tab. Leaving now discards the
                  search — it starts again from the beginning next time, so the
                  move you get is the same either way.
                </p>
              </>
            ) : (
              <p className="error" style={{ margin: 0 }}>{bot.error}</p>
            )}
          </div>
        )}

        <div className="panel">
          <h2>Status</h2>
          <Status
            game={game}
            viewerSide={viewerSide}
            yourTurn={yourTurnOrPlacement}
            signedIn={signedIn}
          />
          {game.status === "open" && viewerSide === 1 && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-danger" onClick={cancel} disabled={pending}>
                Cancel game
              </button>
            </div>
          )}
          {game.status === "open" && game.youAreInvited && (
            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                onClick={() => answerChallenge(true)}
                disabled={pending}
              >
                Accept challenge
              </button>
              <button className="btn" onClick={() => answerChallenge(false)} disabled={pending}>
                Decline
              </button>
            </div>
          )}
          {game.status === "finished" && viewerSide !== null && signedIn && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={playAgain} disabled={pending}>
                {game.botSide !== null ? "Play again" : "Offer a rematch"}
              </button>
              {game.resultReason === "goal" &&
                game.botSide === null &&
                viewerSide === game.result &&
                !game.takebackOffered && (
                  <button className="btn" onClick={() => takeback("offer")} disabled={pending}>
                    Offer takeback
                  </button>
                )}
              {game.takebackOffered && viewerSide === game.result && (
                <span className="muted">Takeback offered — their call.</span>
              )}
              {game.takebackOffered && viewerSide !== game.result && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => takeback("accept")}
                    disabled={pending}
                  >
                    Accept takeback
                  </button>
                  <button className="btn" onClick={() => takeback("decline")} disabled={pending}>
                    Decline
                  </button>
                </>
              )}
            </div>
          )}
          {game.status === "setup" && viewerSide !== null && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-danger" onClick={abandon} disabled={pending}>
                Abandon game
              </button>
            </div>
          )}
          {canClaim && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={claim} disabled={pending}>
                Claim win on time
              </button>
            </div>
          )}
          {game.status === "active" && viewerSide !== null && (
            <div className="row" style={{ marginTop: 14 }}>
              {canGiveBack && (
                <button className="btn" onClick={giveBack} disabled={pending}>
                  {game.botSide === null ? "Give back their turn" : "Take back move"}
                </button>
              )}
              <button
                className="btn btn-danger"
                onClick={resign}
                disabled={pending}
              >
                Resign
              </button>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Moves</h2>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No moves yet.
            </p>
          ) : (
            <ol
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                maxHeight: 320,
                overflowY: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
              }}
            >
              {history.map((h) => {
                const active = (viewingPly ?? game.ply) === h.ply;
                return (
                  <li key={h.ply}>
                    <button
                      onClick={() =>
                        goToPly(h.ply === game.ply ? null : h.ply)
                      }
                      style={{
                        display: "flex",
                        width: "100%",
                        gap: 10,
                        padding: "6px 8px",
                        background: active ? "var(--bg-panel-active)" : "none",
                        border: "none",
                        borderRadius: 4,
                        color: active ? "var(--accent-mint)" : "var(--text-secondary)",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ color: "var(--text-dim)", minWidth: 24 }}>
                        {h.ply}.
                      </span>
                      <span style={{ minWidth: 22 }}>
                        {h.player === 1 ? "P1" : "P2"}
                      </span>
                      <span style={{ flex: 1 }}>
                        {h.kind === "setup"
                          ? `set ${h.move.join("")}`
                          : moveToNotation(h.move)}
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        {describeThinkTime(h.thinkMs)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

      </aside>
    </div>
  );
}


/** How a reviewed ply is described in the banner: setup, or move N of M. */
function describePly(
  history: HistoryEntry[],
  ply: number,
  total: number,
): string {
  const entry = history.find((h) => h.ply === ply);
  if (entry?.kind === "setup") {
    return `Setup — player ${entry.player === 1 ? "1" : "2"} places`;
  }
  const setupPlies = history.filter((h) => h.kind === "setup").length;
  return `Move ${ply - setupPlies} of ${total - setupPlies}`;
}

function PlayerBar({
  name,
  side,
  toMove,
  isYou,
}: {
  name: string | null;
  side: Player;
  toMove: boolean;
  isYou: boolean;
}) {
  return (
    <div className={toMove ? "playerbar to-move" : "playerbar"}>
      <span
        className="playerdot"
        style={{
          background:
            side === 1 ? "var(--accent-mint)" : "var(--accent-amber)",
          opacity: toMove ? 1 : 0.4,
        }}
      />
      <span className="playername">
        {name ? (
          <Link href={`/player/${encodeURIComponent(name)}`}>{name}</Link>
        ) : (
          <span className="muted">waiting for an opponent…</span>
        )}
      </span>
      {isYou && <span className="tag">you</span>}
      {toMove && <span className="tag tag-turn">to move</span>}
    </div>
  );
}

function Status({
  game,
  viewerSide,
  yourTurn,
  signedIn,
}: {
  game: GameSummary;
  viewerSide: Player | null;
  yourTurn: boolean;
  signedIn: boolean;
}) {
  const p1 = game.player1Name ?? "—";
  const p2 = game.player2Name ?? "waiting…";

  const nameLink = (name: string | null) =>
    name ? (
      <Link href={`/player/${encodeURIComponent(name)}`}>{name}</Link>
    ) : (
      <span>—</span>
    );

  if (game.status === "open") {
    return (
      <>
        <p style={{ margin: "0 0 8px" }}>
          {game.invitedName ? (
            <>
              <strong>{nameLink(game.player1Name)}</strong> is waiting for{" "}
              <strong>{nameLink(game.invitedName)}</strong>
              {game.youAreInvited ? " — that is you" : ""}.
            </>
          ) : (
            <>
              <strong>{nameLink(game.player1Name)}</strong> is waiting for an
              opponent.
            </>
          )}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          {describeTimeControl(game.moveSeconds)}.{" "}
          {game.invitedName ? null : signedIn ? (
            <Link href="/">Join from the game list.</Link>
          ) : (
            "Sign in to join."
          )}
        </p>
      </>
    );
  }

  if (game.status === "setup") {
    return (
      <>
        <p style={{ margin: "0 0 8px" }}>
          {yourTurn ? (
            <strong style={{ color: "var(--accent-mint)" }}>
              Place your pieces
            </strong>
          ) : (
            <span>
              Waiting for{" "}
              {nameLink(game.turn === 1 ? game.player1Name : game.player2Name)} to
              place their pieces
            </span>
          )}
        </p>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          The board starts empty. Player 1 arranges their home row, then
          player 2, and then play begins.
        </p>
      </>
    );
  }

  if (game.status === "finished") {
    const label =
      game.result === 0 ? (
        "Drawn"
      ) : (
        <>
          {nameLink(game.result === 1 ? game.player1Name : game.player2Name)} won
        </>
      );
    const how =
      game.resultReason === "resign"
        ? " by resignation"
        : game.resultReason === "timeout"
          ? " on time"
          : "";
    return (
      <>
        <p style={{ margin: "0 0 8px" }}>
          <strong>
            {label}
            {how}
          </strong>
        </p>
        <p className="muted" style={{ margin: 0 }}>
          {game.ply} moves · P1 {nameLink(game.player1Name)} · P2{" "}
          {nameLink(game.player2Name)}
        </p>
      </>
    );
  }

  return (
    <>
      <p style={{ margin: "0 0 8px" }}>
        {yourTurn ? (
          <strong style={{ color: "var(--accent-mint)" }}>Your turn</strong>
        ) : (
          <span>
            Waiting for{" "}
            {nameLink(game.turn === 1 ? game.player1Name : game.player2Name)}
          </span>
        )}
      </p>
      <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
        P1 {nameLink(game.player1Name)} · P2 {nameLink(game.player2Name)}
        <br />
        {describeTimeControl(game.moveSeconds)}
        {game.deadlineAt ? ` · deadline ${relativeTime(game.deadlineAt)}` : ""}
      </p>
    </>
  );
}
