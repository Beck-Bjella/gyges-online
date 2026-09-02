/**
 * A game position at a glance: the diamond, the grid, the rings.
 *
 * Deliberately NOT the Board component. That one carries pointer handlers,
 * animation machinery and a head full of hooks — the right cost for the game
 * page, the wrong one to pay twenty times in a list. This is a pure render:
 * no client directive, no state, no ids (gradients would collide between
 * instances), flat colours that read at thumbnail size where gradients blur.
 *
 * Colours come straight from the site's tokens — the same board, spot and
 * piece variables the big board and the rest of the page use — so a tile can
 * never drift off-palette. The viewBox is sized to the plate's DIAGONAL: a
 * rotated square's tips reach √2 further than its sides, which is what
 * clipped the first version's corners.
 */

import type { BoardState } from "@/lib/game/board";

const SIZE = 132;
const PITCH = 10;
const SPAN = PITCH * 5;
const ORIGIN = (SIZE - SPAN) / 2;
/** Plate side: its tips land at ±side/√2 ≈ ±62 from centre, inside the 66. */
const PLATE = 88;

export default function MiniBoard({
  board,
  lastMove = null,
  mark = null,
  size = 120,
}: {
  board: BoardState;
  /** "from|to[|drop]" as the moves table stores it; drawn as amber legs. */
  lastMove?: string | null;
  /**
   * Squares to ring in mint. Nothing in a game uses this — it is for the
   * rules diagrams, where a sentence like "only these may move" needs the
   * board to say which ones.
   */
  mark?: number[] | null;
  size?: number;
}) {
  const cx = (i: number) => ORIGIN + (i % 6) * PITCH;
  // Row 0 — player 1's home row — at the BOTTOM, the way the board faces its
  // player. Drawn top-down it read as the opponent's view of every game.
  const cy = (i: number) => ORIGIN + (5 - Math.floor(i / 6)) * PITCH;
  /** Any square, the goals included — 37 is the top tip, 36 the bottom. */
  const at = (i: number) =>
    i === 37
      ? { x: SIZE / 2, y: ORIGIN - PITCH }
      : i === 36
        ? { x: SIZE / 2, y: SIZE - ORIGIN + PITCH }
        : { x: cx(i), y: cy(i) };

  const legs: { a: { x: number; y: number }; b: { x: number; y: number }; dash: boolean }[] =
    [];
  if (lastMove) {
    const idx = lastMove.split("|").map(Number);
    if (idx.length >= 2 && idx.every((n) => Number.isFinite(n))) {
      legs.push({ a: at(idx[0]), b: at(idx[1]), dash: false });
      if (idx.length === 3) legs.push({ a: at(idx[1]), b: at(idx[2]), dash: true });
    }
  }

  const pieces: { x: number; y: number; kind: number }[] = [];
  for (let i = 0; i < 36; i++) {
    if (board[i] > 0) pieces.push({ x: cx(i), y: cy(i), kind: board[i] });
  }
  // The goals too — index 37 is the top tip, 36 the bottom, matching the big
  // board's orientation. A finished game's whole story is the piece sitting
  // there, and the first version left it out.
  const goalTop = ORIGIN - PITCH;
  const goalBottom = SIZE - ORIGIN + PITCH;
  if (board[37] > 0) pieces.push({ x: SIZE / 2, y: goalTop, kind: board[37] });
  if (board[36] > 0) pieces.push({ x: SIZE / 2, y: goalBottom, kind: board[36] });

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      className="miniboard"
      aria-hidden="true"
    >
      <rect
        x={(SIZE - PLATE) / 2}
        y={(SIZE - PLATE) / 2}
        width={PLATE}
        height={PLATE}
        rx={6}
        transform={`rotate(45 ${SIZE / 2} ${SIZE / 2})`}
        fill="var(--board-light)"
        stroke="var(--board-edge)"
        strokeWidth="1.5"
      />
      {/* The goal spots at the diamond's tips, like the big board's. */}
      <circle cx={SIZE / 2} cy={ORIGIN - PITCH} r={2.8} fill="var(--gridspot-dark)" />
      <circle
        cx={SIZE / 2}
        cy={SIZE - ORIGIN + PITCH}
        r={2.8}
        fill="var(--gridspot-dark)"
      />
      {Array.from({ length: 36 }, (_, i) => (
        <circle key={i} cx={cx(i)} cy={cy(i)} r={3.3} fill="var(--gridspot-dark)" />
      ))}
      {/* Marked squares, under everything: the diagram's pointing finger. */}
      {(mark ?? []).map((i) => {
        const p = at(i);
        return (
          <circle
            key={`m${i}`}
            cx={p.x}
            cy={p.y}
            r={5.6}
            fill="var(--accent-mint-soft)"
            stroke="var(--accent-mint)"
            strokeWidth="1"
            opacity="0.9"
          />
        );
      })}
      {/* The last move, as the big board draws it: a solid leg for the
          travel, a dashed one for the displaced piece. Under the pieces, so
          the position stays the subject. */}
      {legs.map((l, n) => (
        <line
          key={n}
          x1={l.a.x}
          y1={l.a.y}
          x2={l.b.x}
          y2={l.b.y}
          stroke="var(--accent-amber)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray={l.dash ? "3 2.5" : undefined}
          opacity="0.85"
        />
      ))}
      {/* Pieces: n flat rings, outermost at the edge, a three's centre solid —
          the same silhouette the big board draws. */}
      {pieces.map((p, n) => (
        <g key={n}>
          <circle cx={p.x} cy={p.y} r={4.0} fill="none" stroke="var(--piece-mid)" strokeWidth="1.25" />
          {p.kind >= 2 && (
            <circle cx={p.x} cy={p.y} r={2.5} fill="none" stroke="var(--piece-mid)" strokeWidth="1.05" />
          )}
          {p.kind >= 3 && <circle cx={p.x} cy={p.y} r={1.1} fill="var(--piece-mid)" />}
        </g>
      ))}
    </svg>
  );
}
