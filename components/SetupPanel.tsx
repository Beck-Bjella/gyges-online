"use client";

/**
 * Arranging your home row before play begins.
 *
 * A game does not start from a fixed position: the board begins empty, player 1
 * arranges their six pieces, then player 2 does. This panel is that step.
 *
 * Pieces are placed left to right from the player's own perspective, which is
 * how the board is drawn for them. The arrangement is only submitted once all
 * six are down, so a half-finished row never reaches the server.
 */

import { SETUP_PIECES, type Player } from "@/lib/game/board";
import type { SetupSlots } from "./useSetupSlots";

interface Props {
  side: Player;
  pending: boolean;
  error: string | null;
  /** The row being built, shared with the board so both can edit it. */
  setup: SetupSlots;
  onSubmit: (arrangement: number[]) => void;
}

/**
 * Openings offered as one click, so a player need not think about placement
 * before they have any idea what placement does.
 *
 * Every one is a legal ordering of the same six pieces — there is no advantage
 * baked in, only a shape. The names describe where the large pieces sit,
 * because that is the part that actually changes how the row plays.
 */
const OPENINGS: { name: string; slots: number[] }[] = [
  { name: "Standard", slots: [3, 2, 1, 1, 2, 3] },
  { name: "Centre", slots: [1, 2, 3, 3, 2, 1] },
  { name: "Stepped", slots: [1, 2, 3, 1, 2, 3] },
  { name: "Blocks", slots: [1, 1, 2, 2, 3, 3] },
  { name: "Split", slots: [3, 1, 2, 2, 1, 3] },
];

/** A uniform shuffle of the six pieces. See botSetup() for the same reasoning. */
function randomOpening(): number[] {
  const pieces = [...SETUP_PIECES];
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  return pieces;
}

export default function SetupPanel({
  side,
  pending,
  error,
  setup,
  onSubmit,
}: Props) {
  const { clear, choose, complete, slots } = setup;

  return (
    <div className="panel">
      <h2>Place your pieces</h2>
      <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
        Drag the pieces below the board onto your highlighted home row, or pick
        an opening. Move them around as much as you like — nothing is sent until
        you confirm. You are player {side === 1 ? "1" : "2"}.
      </p>

      <div className="setup-openings">
        {OPENINGS.map((o) => (
          <button
            key={o.name}
            className="opening-choice"
            onClick={() => choose(o.slots)}
            disabled={pending}
            title={`Place ${o.name}`}
          >
            <MiniLine slots={o.slots} />
            <span>{o.name}</span>
          </button>
        ))}
        <button
          className="opening-choice"
          onClick={() => choose(randomOpening())}
          disabled={pending}
          title="Any legal ordering, at random"
        >
          <MiniLine slots={null} />
          <span>Random</span>
        </button>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary"
          onClick={() => onSubmit(slots as number[])}
          disabled={!complete || pending}
        >
          {pending ? "…" : "Confirm placement"}
        </button>
        <button
          className="btn"
          onClick={clear}
          disabled={pending || slots.every((s) => s === null)}
        >
          Clear
        </button>
      </div>

      <p className="muted" style={{ margin: "12px 0 0", lineHeight: 1.5 }}>
        Once confirmed this cannot be changed.
      </p>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * An opening drawn as the row it produces.
 *
 * A name says nothing about the shape, and the shape is the entire difference
 * between one opening and another — so the button shows the line itself and
 * uses the name only as a label. Sized to read at a glance rather than to be
 * studied; the real board is right there for that.
 *
 * `null` slots means "not decided yet", drawn as outlines, which is what the
 * Random button offers.
 */
function MiniLine({ slots }: { slots: number[] | null }) {
  const cells = slots ?? [0, 0, 0, 0, 0, 0];
  return (
    <svg viewBox="0 0 132 24" className="mini-line" aria-hidden>
      {cells.map((kind, i) => {
        const cx = 12 + i * 22;
        if (kind === 0) {
          return (
            <circle
              key={i}
              cx={cx}
              cy={12}
              r={9}
              fill="none"
              stroke="var(--border-subtle)"
              strokeDasharray="3 3"
            />
          );
        }
        return (
          <g key={i}>
            <circle cx={cx} cy={12} r={9.5} fill="var(--piece-mid)" stroke="#3a2818" />
            {Array.from({ length: kind }, (_, i) => ((9.5 - 0.8) * (3 - i)) / 3).map((r) => (
              <circle
                key={r}
                cx={cx}
                cy={12}
                r={r}
                fill="none"
                stroke="var(--piece-ring)"
                strokeWidth="1.8"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
