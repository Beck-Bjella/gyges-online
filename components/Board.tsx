"use client";

/**
 * The Gygès board.
 *
 * SVG in the 900x900 coordinate space described in docs/BOARD_REFERENCE.md,
 * scaled responsively. Drag a piece to an empty square to move it; drop it on
 * an occupied square to displace, then click to place the displaced piece.
 *
 * ## Rules here are a convenience, never a guarantee
 *
 * When `player` is given, the squares a picked-up piece can legally reach are
 * marked, using lib/game/rules.ts — the same module the server validates with.
 * That sharing is only possible because the rules are pure TypeScript with no
 * I/O; it costs no network round trip.
 *
 * This is a HINT. A player can edit their own JavaScript, so the server checks
 * every move again regardless. Nothing here is load-bearing: with `player`
 * omitted the board behaves exactly as it did before, and the server is still
 * the authority either way.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  BOARD_SIZE,
  GRID_SIZE,
  P1_GOAL,
  P2_GOAL,
  PIECE_RADIUS,
  VIEWBOX,
  flipBoard,
  flipMove,
  idxToCenter,
  nearestIndex,
  pieceAt,
  type BoardState,
  type Move,
  type Player,
} from "@/lib/game/board";
import { canMoveFrom, dropSquares, reachableFrom } from "@/lib/game/rules";

interface Props {
  board: BoardState;
  /** Whether the local player may move right now. */
  interactive?: boolean;
  /** Render from player 2's perspective. */
  flipped?: boolean;
  onMove?: (mv: Move) => void;
  /**
   * Squares to ring — the home row while a player is placing.
   *
   * Distinct from `lastMove`, which is drawn as arrows. Ringing the squares of
   * a move showed *where* it touched but not what happened: three unconnected
   * circles for a displacement read as decoration rather than as a move.
   */
  highlight?: number[];
  /** The move to draw, as arrows. Empty or absent draws nothing. */
  lastMove?: Move;
  /**
   * Which side the viewer is playing.
   *
   * Supplied only to mark legal destinations. Omit it and no rule hints are
   * shown; the board still works, and the server is unaffected either way.
   */
  player?: Player;
}

type Drag =
  | { kind: "none" }
  | { kind: "piece"; from: number; x: number; y: number }
  | { kind: "displaced"; from: number; landedOn: number; x: number; y: number };

export default function Board({
  board,
  interactive = false,
  flipped = false,
  onMove,
  highlight = [],
  lastMove = [],
  player,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag>({ kind: "none" });

  // Everything below works in view space. When flipped, the view is the
  // rotated board and moves are mapped back before being emitted.
  const view = useMemo(() => (flipped ? flipBoard(board) : board), [board, flipped]);
  const viewHighlight = useMemo(
    () => (flipped ? flipMove(highlight) : highlight),
    [highlight, flipped],
  );
  const viewLastMove = useMemo(
    () => (flipped ? flipMove(lastMove) : lastMove),
    [lastMove, flipped],
  );

  /**
   * A line between two squares, pulled back at both ends so it starts and stops
   * clear of the pieces rather than disappearing beneath them.
   */
  const arrow = useCallback((fromIdx: number, toIdx: number) => {
    const a = idxToCenter(fromIdx);
    const b = idxToCenter(toIdx);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;

    // Pull back from each end so the arrow points *between* pieces rather than
    // through their centres. Proportional as well as absolute, because a move
    // between neighbouring squares is only one grid pitch long — a fixed inset
    // sized for the pieces would consume the whole line and draw nothing.
    const gap = Math.min(PIECE_RADIUS * 0.8, len * 0.28);
    const head = Math.min(PIECE_RADIUS * 0.9, len * 0.34);

    return {
      x1: a.cx + (dx / len) * gap,
      y1: a.cy + (dy / len) * gap,
      x2: a.cx + (dx / len) * (len - head),
      y2: a.cy + (dy / len) * (len - head),
    };
  }, []);

  const toBoardSpace = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * VIEWBOX,
      y: ((e.clientY - rect.top) / rect.height) * VIEWBOX,
    };
  }, []);

  const emit = useCallback(
    (mv: Move) => {
      onMove?.(flipped ? flipMove(mv) : mv);
    },
    [onMove, flipped],
  );

  /**
   * View-space helper: the rules work in board space, the board draws in view
   * space, and flipMove maps between them (it is its own inverse).
   */
  const toView = useCallback(
    (indices: number[]) => (flipped ? flipMove(indices) : indices),
    [flipped],
  );
  const toBoard = useCallback(
    (i: number) => (flipped ? flipMove([i])[0] : i),
    [flipped],
  );

  /**
   * Where the piece in hand can finish.
   *
   * Computed from the unflipped board, because the rules are stated in board
   * space; the resulting indices are mapped back for drawing.
   */
  const legalTargets = useMemo(() => {
    if (!interactive || player === undefined) return new Set<number>();
    if (drag.kind !== "piece") return new Set<number>();

    const fromBoard = toBoard(drag.from);
    if (!canMoveFrom(board, player, fromBoard)) return new Set<number>();

    return new Set(toView([...reachableFrom(board, player, fromBoard)]));
  }, [interactive, player, drag, board, toView, toBoard]);

  /**
   * Where a displaced piece may be put down.
   *
   * Not simply "anywhere empty": a displaced piece may not be dropped behind
   * the opponent's active line, and the square the mover vacated IS available.
   * dropSquares knows both rules, so this shows the real answer rather than an
   * approximation the server would then reject.
   */
  const dropTargets = useMemo(() => {
    if (!interactive || player === undefined) return new Set<number>();
    if (drag.kind !== "displaced") return new Set<number>();

    const fromBoard = toBoard(drag.from);
    const landedBoard = toBoard(drag.landedOn);
    const squares = dropSquares(board, player, fromBoard).filter(
      (i) => i !== landedBoard,
    );
    return new Set(toView(squares));
  }, [interactive, player, drag, board, toView, toBoard]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const p = toBoardSpace(e);
      if (!p) return;

      // Placing a displaced piece takes priority over starting a new drag.
      if (drag.kind === "displaced") {
        const target = nearestIndex(p.x, p.y, view, true);
        // The square the mover came from is a legal home for the displaced
        // piece — it is empty by the time the move resolves, and dropTargets
        // already marks it. Excluding it here made clicking a highlighted
        // square silently cancel the move instead.
        if (target !== null && dropTargets.has(target)) {
          emit([drag.from, drag.landedOn, target]);
        }
        setDrag({ kind: "none" });
        return;
      }

      const from = pieceAt(p.x, p.y, view);
      if (from === null || from >= GRID_SIZE) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "piece", from, x: p.x, y: p.y });
    },
    [interactive, toBoardSpace, drag, view, emit, dropTargets],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drag.kind === "none") return;
      const p = toBoardSpace(e);
      if (!p) return;
      setDrag({ ...drag, x: p.x, y: p.y });
    },
    [drag, toBoardSpace],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drag.kind !== "piece") return;
      const p = toBoardSpace(e);
      if (p) {
        const target = nearestIndex(p.x, p.y, view, false);
        if (target !== null && target !== drag.from) {
          if (view[target] === 0) {
            emit([drag.from, target]);
            setDrag({ kind: "none" });
            return;
          }
          if (target < GRID_SIZE) {
            // Landed on a piece: carry the displaced one until it is placed.
            setDrag({ kind: "displaced", from: drag.from, landedOn: target, x: p.x, y: p.y });
            return;
          }
        }
      }
      setDrag({ kind: "none" });
    },
    [drag, toBoardSpace, view, emit],
  );

  // ---- what to draw -------------------------------------------------------

  const pieces: { key: string; idx: number; kind: number; cx: number; cy: number; lifted: boolean }[] =
    [];

  for (let i = 0; i < BOARD_SIZE; i++) {
    const kind = view[i];
    if (kind === 0) continue;
    // The piece being dragged, and a displaced piece in hand, follow the cursor.
    if (drag.kind === "piece" && i === drag.from) continue;
    if (drag.kind === "displaced" && (i === drag.from || i === drag.landedOn)) continue;
    const { cx, cy } = idxToCenter(i);
    pieces.push({ key: `p${i}`, idx: i, kind, cx, cy, lifted: false });
  }

  if (drag.kind === "piece") {
    pieces.push({
      key: "dragging",
      idx: drag.from,
      kind: view[drag.from],
      cx: drag.x,
      cy: drag.y,
      lifted: true,
    });
  }

  if (drag.kind === "displaced") {
    // The moving piece has settled on its landing square...
    const at = idxToCenter(drag.landedOn);
    pieces.push({
      key: "settled",
      idx: drag.landedOn,
      kind: view[drag.from],
      cx: at.cx,
      cy: at.cy,
      lifted: false,
    });
    // ...and the displaced piece is in hand.
    pieces.push({
      key: "inhand",
      idx: drag.landedOn,
      kind: view[drag.landedOn],
      cx: drag.x,
      cy: drag.y,
      lifted: true,
    });
  }

  const snapTarget = (() => {
    if (drag.kind === "piece") return nearestIndex(drag.x, drag.y, view, false);
    if (drag.kind === "displaced") return nearestIndex(drag.x, drag.y, view, true);
    return null;
  })();

  /**
   * Every square to mark right now.
   *
   * Only while something is in hand: at rest the board stays clean. Marking the
   * movable pieces before a player has touched anything was tried and read as
   * clutter — the question "where can this go" is worth answering, "which
   * pieces are mine" is one the player should be reading off the board.
   */
  const marked =
    drag.kind === "displaced" ? dropTargets : drag.kind === "piece" ? legalTargets : new Set<number>();

  /** Split by what is there: a bare square gets a dot, a piece gets one on top. */
  const markedEmpty = [...marked].filter((i) => view[i] === 0);
  const markedPieces = [...marked].filter((i) => view[i] !== 0);

  /** Whether the piece in hand is one this player is allowed to move at all. */
  const holdingIllegally =
    interactive &&
    player !== undefined &&
    drag.kind === "piece" &&
    !canMoveFrom(board, player, toBoard(drag.from));

  const gridIndices = Array.from({ length: GRID_SIZE }, (_, i) => i);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="board"
      style={{ touchAction: "none", cursor: interactive ? "pointer" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag({ kind: "none" })}
    >
      <defs>
        <linearGradient id="board-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--board-light)" />
          <stop offset="100%" stopColor="var(--board-dark)" />
        </linearGradient>
        <radialGradient id="piece-gradient" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0%" stopColor="var(--piece-light)" />
          <stop offset="55%" stopColor="var(--piece-mid)" />
          <stop offset="100%" stopColor="var(--piece-dark)" />
        </radialGradient>
        <radialGradient id="gridspot-gradient" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="var(--gridspot-light)" />
          <stop offset="100%" stopColor="var(--gridspot-dark)" />
        </radialGradient>
        <radialGradient id="bearoff-gradient" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="var(--bear-off-light)" />
          <stop offset="100%" stopColor="var(--bear-off-dark)" />
        </radialGradient>
        <filter id="board-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="22" floodColor="#000" floodOpacity="0.7" />
        </filter>
        <filter id="piece-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.6" />
        </filter>
        {/* Arrowhead for the last-move arrows. `context-stroke` makes it take
            the colour of the line it terminates, so the solid and dotted
            arrows need only one marker between them. */}
        <marker
          id="arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent-amber)" />
        </marker>

        <filter id="lifted-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#000" floodOpacity="0.65" />
        </filter>
      </defs>

      <g filter="url(#board-shadow)">
        <path
          d="M 450 17 L 883 450 L 450 883 L 17 450 Z"
          fill="url(#board-gradient)"
          stroke="var(--board-edge)"
          strokeWidth="2"
        />
      </g>
      <path
        d="M 450 37 L 863 450 L 450 863 L 37 450 Z"
        fill="none"
        stroke="rgba(184, 154, 112, 0.18)"
        strokeWidth="1"
      />

      {gridIndices.map((i) => {
        const { cx, cy } = idxToCenter(i);
        return (
          <circle
            key={`spot${i}`}
            cx={cx}
            cy={cy}
            r="30"
            fill="url(#gridspot-gradient)"
            stroke="rgba(20,12,5,0.5)"
            strokeWidth="1"
          />
        );
      })}

      {[P1_GOAL, P2_GOAL].map((i) => {
        const { cx, cy } = idxToCenter(i);
        return (
          <circle
            key={`goal${i}`}
            cx={cx}
            cy={cy}
            r="34"
            fill="url(#bearoff-gradient)"
            stroke="rgba(20,12,5,0.5)"
            strokeWidth="1"
          />
        );
      })}

      {/* Where the player may act, as a dot on the square.
          A hint only — the server validates every move regardless. Drawn before
          the pieces so a dot never sits on top of one; the dots that belong ON
          a piece are drawn after them instead. */}
      {markedEmpty.map((i) => {
        const { cx, cy } = idxToCenter(i);
        return (
          <circle
            key={`dot${i}`}
            cx={cx}
            cy={cy}
            r="13"
            fill="var(--accent-mint)"
            opacity="0.45"
            pointerEvents="none"
          />
        );
      })}

      {/* Holding a piece that cannot be moved at all — the wrong row. Marked on
          the piece's own square so the reason is where the player is looking. */}
      {holdingIllegally && (
        <circle
          cx={idxToCenter(drag.kind === "piece" ? drag.from : 0).cx}
          cy={idxToCenter(drag.kind === "piece" ? drag.from : 0).cy}
          r="36"
          fill="none"
          stroke="var(--accent-red)"
          strokeWidth="2.5"
          opacity="0.7"
          pointerEvents="none"
        />
      )}

      {/* Squares to ring — the home row while placing. */}
      {viewHighlight.map((i) => {
        const { cx, cy } = idxToCenter(i);
        return (
          <circle
            key={`hl${i}`}
            cx={cx}
            cy={cy}
            r="35"
            fill="none"
            stroke="var(--accent-blue)"
            strokeWidth="2.5"
            opacity="0.5"
          />
        );
      })}

      {snapTarget !== null && (
        <circle
          cx={idxToCenter(snapTarget).cx}
          cy={idxToCenter(snapTarget).cy}
          r="36"
          fill="none"
          stroke="var(--accent-mint)"
          strokeWidth="2.5"
          opacity="0.9"
        />
      )}

      {pieces.map((p) => (
        <g
          key={p.key}
          transform={`translate(${p.cx} ${p.cy})`}
          filter={p.lifted ? "url(#lifted-shadow)" : "url(#piece-shadow)"}
          style={{ pointerEvents: "none" }}
        >
          <circle
            r={p.lifted ? PIECE_RADIUS * 1.08 : PIECE_RADIUS}
            fill="url(#piece-gradient)"
            stroke="#3a2818"
            strokeWidth="1"
          />
          <circle r="26" fill="none" stroke="var(--piece-ring)" strokeWidth="2.5" />
          {p.kind >= 2 && (
            <circle r="19" fill="none" stroke="var(--piece-ring)" strokeWidth="2.5" />
          )}
          {p.kind >= 3 && (
            <circle r="12" fill="none" stroke="var(--piece-ring)" strokeWidth="2.5" />
          )}
        </g>
      ))}
      {/* Dots that belong on a piece — one the piece in hand may land on and
          displace. Drawn after the pieces so they are not hidden beneath them,
          and ringed in the board's dark tone so a mint dot stays legible
          against the pale piece. */}
      {markedPieces.map((i) => {
        const { cx, cy } = idxToCenter(i);
        return (
          <circle
            key={`pdot${i}`}
            cx={cx}
            cy={cy}
            r="9"
            fill="var(--accent-mint)"
            stroke="var(--piece-ring)"
            strokeWidth="1.5"
            opacity="0.9"
            pointerEvents="none"
          />
        );
      })}

      {/* The last move, drawn as arrows so it reads as an action rather than a
          scattering of circles. A solid arrow is the piece travelling; a dashed
          one is the piece it displaced being pushed aside.

          Each is drawn twice: a dark casing first, then the bright line over it.
          The board is warm brown and the pieces are pale, so a single-colour
          line washes out against one or the other wherever it happens to pass. */}
      {viewLastMove.length >= 2 &&
        (() => {
          const travel = arrow(viewLastMove[0], viewLastMove[1]);
          const push =
            viewLastMove.length === 3 ? arrow(viewLastMove[1], viewLastMove[2]) : null;
          return (
            <g pointerEvents="none">
              {travel && (
                <>
                  <line {...travel} stroke="#1a1108" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
                  <line
                    {...travel}
                    stroke="var(--accent-amber)"
                    strokeWidth="5.5"
                    strokeLinecap="round"
                    markerEnd="url(#arrowhead)"
                  />
                </>
              )}
              {push && (
                <>
                  <line {...push} stroke="#1a1108" strokeWidth="8" strokeLinecap="round" opacity="0.55" />
                  <line
                    {...push}
                    stroke="var(--accent-amber)"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    strokeDasharray="9 8"
                    markerEnd="url(#arrowhead)"
                  />
                </>
              )}
            </g>
          );
        })()}

    </svg>
  );
}
