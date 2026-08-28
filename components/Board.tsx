"use client";

/**
 * The Gygès board.
 *
 * SVG in the 900x900 coordinate space described in docs/BOARD_REFERENCE.md,
 * scaled responsively. Drag a piece to an empty square to move it; drop it on
 * an occupied square to displace, then click to place the displaced piece.
 *
 * This component performs NO rules checking. It only enforces the structural
 * shape of a move (something to move, somewhere to put it). Legality belongs
 * to the server, and eventually to the engine.
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
} from "@/lib/game/board";

interface Props {
  board: BoardState;
  /** Whether the local player may move right now. */
  interactive?: boolean;
  /** Render from player 2's perspective. */
  flipped?: boolean;
  onMove?: (mv: Move) => void;
  /** Indices to highlight, e.g. the most recent move. */
  highlight?: number[];
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

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const p = toBoardSpace(e);
      if (!p) return;

      // Placing a displaced piece takes priority over starting a new drag.
      if (drag.kind === "displaced") {
        const target = nearestIndex(p.x, p.y, view, true);
        if (target !== null && target !== drag.from) {
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
    [interactive, toBoardSpace, drag, view, emit],
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
    </svg>
  );
}
