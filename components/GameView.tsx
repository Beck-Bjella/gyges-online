"use client";

/**
 * The game screen: board, status, and move history.
 *
 * Moves are submitted to the server, which is the authority on turn order and
 * the game record. This component optimistically shows the resulting position
 * while the request is in flight, and reconciles with whatever the server
 * returns.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Board from "./Board";
import SetupPanel from "./SetupPanel";
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
  // You sit at the bottom by default; the flip control lets you look from the
  // other side, which also moves the player bars to match.
  const [flipped, setFlipped] = useState(viewerSide === -1);

  // A new server position supersedes any optimistic one.
  useEffect(() => {
    setOptimistic(null);
  }, [board]);

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

  const shownBoard = previewBoard ?? displayBoard;

  const reviewing = viewingPly !== null && viewingPly !== game.ply;

  const yourTurn =
    game.status === "active" && viewerSide !== null && viewerSide === game.turn;
  const canMove = yourTurn && !pending && !reviewing;
  // For the status panel, "your turn" covers placing as well as moving.
  const yourTurnOrPlacement =
    viewerSide !== null &&
    viewerSide === game.turn &&
    (game.status === "active" || game.status === "setup");

  // Placing pieces: the board starts empty and each player arranges their home
  // row before play begins.
  const inSetup = game.status === "setup";
  const yourPlacement = inSetup && viewerSide !== null && viewerSide === game.turn;

  const lastMove = history.length ? history[history.length - 1].move : [];
  const highlight = yourPlacement
    ? homeRow(viewerSide!)
    : reviewing
      ? (history.find((h) => h.ply === viewingPly)?.move ?? [])
      : lastMove;

  const submit = useCallback(
    async (mv: Move) => {
      setError(null);
      setPending(true);
      setOptimistic(applyMove(liveBoard, mv));
      try {
        const res = await fetch(`/api/games/${game.id}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ move: mv }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setOptimistic(null);
          setError(body.error ?? "The server rejected that move.");
        } else {
          router.refresh();
        }
      } catch {
        setOptimistic(null);
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
          setSetupPreview(null);
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
  // saves. The probe returns three numbers, and only a real change triggers a
  // refresh.
  //
  // This runs during setup as well as play — placing your pieces is a turn
  // like any other, and waiting for an opponent to place is exactly when you
  // want the page to update itself. Polling stops once the game is over, and
  // pauses while the tab is hidden so a forgotten tab is not making requests
  // all day.
  useEffect(() => {
    const inPlay = game.status === "active" || game.status === "setup";
    if (!inPlay) return;

    let stopped = false;

    async function poll() {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(`/api/games/${game.id}/version`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const v = (await res.json()) as {
          ply: number;
          status: string;
          updated_at: number;
        };
        // Any of these moving means something happened. updated_at catches
        // changes that leave the ply alone, such as a resignation.
        const changed =
          v.ply !== game.ply ||
          v.status !== game.status ||
          v.updated_at !== game.updatedAt;
        // Never refresh while the player has an action in flight.
        if (changed && !stopped && !pending) {
          router.refresh();
        }
      } catch {
        // A failed poll is not worth surfacing; the next one will retry.
      }
    }

    const id = setInterval(poll, 5000);
    // Check immediately when the tab is brought back to the foreground.
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [game.id, game.ply, game.status, game.updatedAt, pending, router]);

  // Arrow keys step through history, as the desktop versions did.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        setViewingPly((p) => {
          const cur = p ?? game.ply;
          return Math.max(0, cur - 1);
        });
      } else if (e.key === "ArrowRight") {
        setViewingPly((p) => {
          if (p === null) return null;
          const next = p + 1;
          return next >= game.ply ? null : next;
        });
      } else if (e.key === "ArrowUp") {
        setViewingPly(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game.ply]);

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
    <div className="grid-2">
      <div>
        <PlayerBar {...seat(topSide)} />

        <div className={reviewing ? "board-wrap reviewing" : "board-wrap"}>
          <Board
            board={shownBoard}
            interactive={canMove}
            flipped={flipped}
            onMove={submit}
            highlight={highlight}
            // Marks legal destinations while dragging. A convenience only —
            // the server validates every move regardless. Passing undefined
            // rather than null when there is no viewer keeps the hint off for
            // spectators, who have no side to move for.
            player={viewerSide ?? undefined}
          />
          {reviewing && (
            <div className="review-banner">
              <span>
                {viewingPly === 0
                  ? "Empty board"
                  : describePly(history, viewingPly!, game.ply)}{" "}
                — you cannot play from here
              </span>
              <button className="btn btn-primary" onClick={() => setViewingPly(null)}>
                Back to live
              </button>
            </div>
          )}
        </div>

        <PlayerBar {...seat(bottomSide)} />

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => setFlipped((f) => !f)}>
            Flip board
          </button>
          <button
            className="btn"
            onClick={() => setViewingPly(0)}
            disabled={game.ply === 0 || viewingPly === 0}
            title="The position this game started from"
          >
            Start
          </button>
          <button
            className="btn"
            onClick={() => setViewingPly(null)}
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
            onSubmit={submitSetupArrangement}
            onPreview={setSetupPreview}
          />
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
                        setViewingPly(h.ply === game.ply ? null : h.ply)
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
