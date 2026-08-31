"use client";

/**
 * The game screen: board, status, and move history.
 *
 * Moves are submitted to the server, which is the authority on turn order and
 * the game record. This component optimistically shows the resulting position
 * while the request is in flight, and reconciles with whatever the server
 * returns.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Board from "./Board";
import SetupPanel from "./SetupPanel";
import { useSetupSlots } from "./useSetupSlots";
import { useBotTurn } from "./useBotTurn";
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

  // A staged move is shown as though played, so the player judges the position
  // they would actually get. Not applied while reviewing history, where the
  // board is showing some earlier position instead.
  const stagedBoard = useMemo(() => {
    if (!staged || viewingPly !== null) return null;
    return applyMove(displayBoard, staged);
  }, [staged, viewingPly, displayBoard]);

  const shownBoard = previewBoard ?? stagedBoard ?? displayBoard;

  const reviewing = viewingPly !== null && viewingPly !== game.ply;

  const yourTurn =
    game.status === "active" && viewerSide !== null && viewerSide === game.turn;
  const canMove = yourTurn && !pending && !reviewing && staged === null;

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

  // The opponent's move, when it lands.
  useEffect(() => {
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
  const stopRun = useCallback(() => {
    if (run.current !== null) clearTimeout(run.current);
    run.current = null;
  }, []);
  useEffect(() => stopRun, [stopRun]);

  /**
   * How hurried a replay step is, by how many plies are still to come.
   *
   * One move on its own plays at full length; a short hop is a little quicker;
   * a jump across a whole game compresses hard. Speed is decided per step from
   * the REMAINING distance, so a long run starts fast and eases out as it
   * approaches the target — the last few moves are the ones worth seeing.
   */
  const paceFor = (remaining: number) =>
    Math.max(0.18, 1 / (1 + (remaining - 1) * 0.45));

  /**
   * Every way of moving through history funnels through here, so direction and
   * distance are decided in exactly one place.
   *
   * A jump of more than one ply walks there a step at a time, each step
   * landing on a real intermediate position and playing that one move — there
   * is no faked composite. Any navigation cancels a run already going, so
   * leaning on a key cannot pile up an animation debt: each press starts
   * fresh from wherever the walk had got to.
   */
  const goToPly = useCallback(
    (target: number | null) => {
      stopRun();
      const resolve = (p: number | null) => p ?? game.ply;
      const moveAt = (ply: number): Move | null => {
        const h = history.find((x) => x.ply === ply);
        return h && h.kind === "move" ? h.move : null;
      };

      const step = () => {
        setViewingPly((current) => {
          const cur = resolve(current);
          const tgt = resolve(target);
          if (cur === tgt) return current;

          const next = cur + Math.sign(tgt - cur);
          const remaining = Math.abs(tgt - cur);
          const speed = paceFor(remaining);
          const reverse = next < cur;
          // Backwards, the move being animated is the one just undone — the
          // move AT the square we left, not the one we land on.
          const mv = moveAt(reverse ? cur : next);
          if (mv) {
            setAnim({ key: `h${next}:${reverse ? "r" : "f"}`, move: mv, reverse, speed });
          }
          if (next !== tgt) {
            // The next step waits about as long as this one takes to play.
            run.current = setTimeout(step, Math.max(120, 480 * paceFor(remaining - 1)));
          }
          return next === game.ply ? null : next;
        });
      };

      if (resolve(target) !== resolve(viewingPly)) step();
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
      enabled:
        (game.status === "active" || game.status === "setup") &&
        !pending &&
        staged === null,
    },
  );

  // Arrow keys step through history, as the desktop versions did.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        goToPly(Math.max(0, (viewingPly ?? game.ply) - 1));
      } else if (e.key === "ArrowRight") {
        if (viewingPly !== null) goToPly(Math.min(game.ply, viewingPly + 1));
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
    <div className="grid-2 game-grid">
      <div>
        <PlayerBar {...seat(topSide)} />

        <div className={reviewing ? "board-wrap reviewing" : "board-wrap"}>
          <Board
            board={shownBoard}
            interactive={canMove}
            flipped={flipped}
            onMove={stage}
            highlight={highlight}
            lastMove={shownMove}
            // Marks legal destinations while dragging. A convenience only —
            // the server validates every move regardless. Passing undefined
            // rather than null when there is no viewer keeps the hint off for
            // spectators, who have no side to move for.
            player={viewerSide ?? undefined}
            setupSide={yourPlacement ? viewerSide! : undefined}
            onSetupSquare={setup.placeAt}
            setupRemaining={setup.remaining}
            animate={anim}
            onSetupDrop={setup.dropAt}
            onSetupMove={setup.moveSlot}
          />
          {reviewing && (
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

        {/* A staged move, waiting to be sent. Placed under the board because
            that is where the player is looking once they have dragged. */}
        {staged && viewingPly === null && (
          <div className="panel staged-move" style={{ marginTop: 14 }}>
            <div className="row">
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{moveToNotation(staged)}</strong>
                <span className="muted"> · not sent yet</span>
              </span>
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
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => setFlipped((f) => !f)}>
            Flip board
          </button>
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
          <span className="muted">
            {reviewing
              ? `Reviewing move ${viewingPly} of ${game.ply}`
              : "← → to review history"}
          </span>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          {game.status === "active" && viewerSide !== null && (
            <div className="row" style={{ marginTop: 14 }}>
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

        <div className="panel">
          <h2>How to move</h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            Drag a piece to an empty space. Drop it on an occupied space to
            displace that piece, then click an empty space to place it.
          </p>
          <p className="muted" style={{ marginBottom: 0, lineHeight: 1.6 }}>
            Legality is not checked yet, so follow the{" "}
            <Link href="/rules">rules</Link> yourself.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** How to describe a point in the history: a placement, or a move number. */
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
          <strong>{p1}</strong> is waiting for an opponent.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          {describeTimeControl(game.moveSeconds)}.{" "}
          {signedIn ? (
            <Link href="/">Join from the game list.</Link>
          ) : (
            "Sign in to join."
          )}
        </p>
      </>
    );
  }

  if (game.status === "setup") {
    const placing = game.turn === 1 ? p1 : p2;
    return (
      <>
        <p style={{ margin: "0 0 8px" }}>
          {yourTurn ? (
            <strong style={{ color: "var(--accent-mint)" }}>
              Place your pieces
            </strong>
          ) : (
            <span>Waiting for {placing} to place their pieces</span>
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
      game.result === 0
        ? "Drawn"
        : game.result === 1
          ? `${p1} won`
          : `${p2} won`;
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
        ) : viewerSide !== null ? (
          <span>Waiting for your opponent</span>
        ) : (
          <span>
            {game.turn === 1 ? p1 : p2} to move
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
