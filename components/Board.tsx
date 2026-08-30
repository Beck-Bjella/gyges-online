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
  homeRow,
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
  /**
   * The side arranging its home row, while setup is in progress.
   *
   * Set only for the player actually placing. It turns the board into the
   * placement surface — clicking a home-row square is how a piece goes down —
   * which is more direct than reading a row of numbered slots in a panel and
   * mapping them onto the board yourself.
   */
  setupSide?: Player;
  /** Home-row position clicked, 0-5 from that player's own left. */
  onSetupSquare?: (slot: number) => void;
  /** Pieces not yet placed, drawn in the tray under the board. */
  setupRemaining?: number[];
  /** A tray piece dropped onto home-row position `slot`. */
  onSetupDrop?: (slot: number, piece: number) => void;
  /** A placed piece moved to another square, or off the row when null. */
  onSetupMove?: (fromSlot: number, toSlot: number | null) => void;
}

type Drag =
  | { kind: "none" }
  | { kind: "piece"; from: number; x: number; y: number }
  | { kind: "displaced"; from: number; landedOn: number; x: number; y: number }
  // A piece in hand during setup, from the tray or lifted off the row.
  | {
      kind: "tray";
      piece: number;
      /** Tray position it came from, so it can be hidden there. */
      slot: number | null;
      /** Home-row position it came from, if it was already placed. */
      fromSlot: number | null;
      x: number;
      y: number;
    };

/**
 * Where the setup tray sits, in view space.
 *
 * Inside the board's own SVG, below the goal, rather than as separate markup in
 * the page. Dragging from one element onto another means hit-testing across
 * two coordinate systems; drawn here it is the same surface, and the pointer
 * handling that already moves pieces moves these too.
 */
const TRAY_CY = 828;
const TRAY_PITCH = 76;
const trayCx = (i: number) => VIEWBOX / 2 + (i - 2.5) * TRAY_PITCH;

/** The most rings any piece carries, which fixes where every ring sits. */
const MAX_RINGS = 3;

/** How thick each ring is drawn. */
const RING_WIDTH = 6;

/**
 * Where a piece's rings sit, outermost first.
 *
 * The step is the same on every piece — a third of the radius — so a two's
 * inner ring lands exactly where a three's middle ring does. Dividing by the
 * piece's own count instead put them at different radii, which made the pieces
 * read as different sizes of thing rather than as one, two and three of the
 * same thing.
 *
 * The outermost is always on the edge, inset by the stroke's half-width so it
 * sits on the piece rather than straddling its border.
 */
function ringRadii(kind: number, radius: number): number[] {
  const outer = radius - RING_WIDTH / 2;
  return Array.from({ length: kind }, (_, i) => (outer * (MAX_RINGS - i)) / MAX_RINGS);
}

export default function Board({
  board,
  interactive = false,
  flipped = false,
  onMove,
  highlight = [],
  lastMove = [],
  player,
  setupSide,
  onSetupSquare,
  setupRemaining = [],
  onSetupDrop,
  onSetupMove,
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
      const p = toBoardSpace(e);
      if (!p) return;

      // Placing during setup, which happens before the board is interactive in
      // the ordinary sense — there is no move to make yet.
      if (setupSide !== undefined && onSetupSquare) {
        // A tray piece under the pointer is picked up and carried.
        const trayIdx = setupRemaining.findIndex(
          (_, i) => Math.hypot(p.x - trayCx(i), p.y - TRAY_CY) <= PIECE_RADIUS,
        );
        if (trayIdx >= 0) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({
            kind: "tray",
            piece: setupRemaining[trayIdx],
            slot: trayIdx,
            fromSlot: null,
            x: p.x,
            y: p.y,
          });
          return;
        }
        // Occupied squares included, or a piece already placed could never be
        // picked up again.
        const target = nearestIndex(p.x, p.y, view, false);
        if (target === null) return;
        const slot = homeRow(setupSide).indexOf(toBoard(target));
        if (slot < 0) return;

        // A piece already on the row is lifted off, so it can be moved to
        // another square or carried back to the tray.
        const placed = board[homeRow(setupSide)[slot]];
        if (placed !== 0) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ kind: "tray", piece: placed, slot: null, fromSlot: slot, x: p.x, y: p.y });
          return;
        }
        onSetupSquare(slot);
        return;
      }

      if (!interactive) return;

      // Placing a displaced piece takes priority over starting a new drag.
      if (drag.kind === "displaced") {
        // onlyEmpty must stay false: the square the mover came from still holds
        // it in `view`, so skipping occupied squares would hide the one target
        // that most needs to be reachable. dropTargets is what decides validity.
        const target = nearestIndex(p.x, p.y, view, false);
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
    [
      interactive,
      toBoardSpace,
      drag,
      view,
      emit,
      dropTargets,
      setupSide,
      onSetupSquare,
      setupRemaining,
      toBoard,
    ],
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
      if (drag.kind === "tray") {
        const p = toBoardSpace(e);
        if (p && setupSide !== undefined) {
          // Occupied included: dropping onto a filled square is a swap.
          const target = nearestIndex(p.x, p.y, view, false);
          const slot = target === null ? -1 : homeRow(setupSide).indexOf(toBoard(target));
          if (drag.fromSlot !== null) {
            // Onto another square it swaps; anywhere off the row it goes back
            // to the tray; onto its own square nothing happens, so picking a
            // piece up and thinking better of it costs nothing.
            if (slot !== drag.fromSlot) onSetupMove?.(drag.fromSlot, slot >= 0 ? slot : null);
          } else if (slot >= 0) {
            onSetupDrop?.(slot, drag.piece);
          }
        }
        setDrag({ kind: "none" });
        return;
      }
      if (drag.kind !== "piece") return;
      const p = toBoardSpace(e);
      if (p) {
        const target = nearestIndex(p.x, p.y, view, false);
        if (target !== null) {
          // Back where it started. A piece may travel its full count and end on
          // its own square, so this is a move rather than a cancelled drag —
          // but only where the path actually allows it, which legalTargets
          // knows. Where it does not, dropping a piece back is how a player
          // changes their mind, and that still works.
          //
          // Checked before the emptiness test below, because the square is not
          // empty in `view`: the piece is still recorded there, so it would
          // otherwise read as a displacement onto itself.
          if (target === drag.from) {
            if (legalTargets.has(target)) emit([drag.from, target]);
            setDrag({ kind: "none" });
            return;
          }
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
    [
      drag,
      toBoardSpace,
      view,
      emit,
      legalTargets,
      setupSide,
      onSetupDrop,
      onSetupMove,
      toBoard,
    ],
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
    if (
      drag.kind === "tray" &&
      drag.fromSlot !== null &&
      setupSide !== undefined &&
      i === toView([homeRow(setupSide)[drag.fromSlot]])[0]
    ) {
      continue;
    }
    const { cx, cy } = idxToCenter(i);
    pieces.push({ key: `p${i}`, idx: i, kind, cx, cy, lifted: false });
  }

  // The setup tray, and whatever has been lifted out of it.
  if (setupSide !== undefined) {
    setupRemaining.forEach((kind, i) => {
      if (drag.kind === "tray" && drag.slot === i) return;
      pieces.push({
        key: `tray${i}`,
        idx: -1,
        kind,
        cx: trayCx(i),
        cy: TRAY_CY,
        lifted: false,
      });
    });
  }
  if (drag.kind === "tray") {
    pieces.push({
      key: "tray-dragging",
      idx: -1,
      kind: drag.piece,
      cx: drag.x,
      cy: drag.y,
      lifted: true,
    });
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
        {/* Rings share one light source. The default bounding-box units would
            scale the gradient to each circle, so every ring would carry its own
            highlight and the piece would stop reading as one object. Drawn in
            user space, offset up and left, they are lit together. */}
        <radialGradient
          id="ring-gradient"
          gradientUnits="userSpaceOnUse"
          cx="-11"
          cy="-13"
          r="48"
        >
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
          markerWidth="3.8"
          markerHeight="3.8"
          orient="auto-start-reverse"
        >
          {/* Outlined like the shafts are. Without it the head — the widest,
              most visible part of the arrow — was the one piece with no edge,
              so it washed out wherever it crossed a pale piece. */}
          <path
            d="M 0 1 L 9 5 L 0 9 z"
            fill="var(--accent-amber)"
            stroke="#1a1108"
            strokeWidth="1.6"
            strokeOpacity="0.55"
            strokeLinejoin="round"
            paintOrder="stroke"
          />
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
          {/* A piece is its rings and nothing else — the middle is the board
              showing through. So the rings are drawn in the pale piece colour
              rather than the dark one, which only ever worked as an inlay on a
              filled disc. The innermost ring of a three is solid: at that size
              a ring reads as a smudge rather than a ring. */}
          {(() => {
            const radius = p.lifted ? PIECE_RADIUS * 1.08 : PIECE_RADIUS;
            const radii = ringRadii(p.kind, radius);
            return radii.map((r, i) =>
              i === MAX_RINGS - 1 ? (
                <circle key={r} r={r + RING_WIDTH / 2} fill="url(#ring-gradient)" />
              ) : (
                <circle
                  key={r}
                  r={r}
                  fill="none"
                  stroke="url(#ring-gradient)"
                  strokeWidth={RING_WIDTH}
                />
              ),
            );
          })()}
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
