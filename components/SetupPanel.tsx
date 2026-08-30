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

const RING_LABEL: Record<number, string> = {
  1: "one ring",
  2: "two rings",
  3: "three rings",
};

export default function SetupPanel({
  side,
  pending,
  error,
  setup,
  onSubmit,
}: Props) {
  const { slots, remaining, held, hold, placeAt, clear, choose, complete } = setup;

  return (
    <div className="panel">
      <h2>Place your pieces</h2>
      <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
        Click a square on your highlighted home row to place a piece, or pick
        one up here first to choose which. You are player{" "}
        {side === 1 ? "1" : "2"}.
      </p>

      <div className="setup-slots">
        {slots.map((piece, i) => (
          <button
            key={i}
            className={piece === null ? "setup-slot" : "setup-slot filled"}
            onClick={() => placeAt(i)}
            disabled={pending}
            title={
              piece === null
                ? held
                  ? `Place the ${RING_LABEL[held]} piece here`
                  : "Empty — click to place the next piece"
                : `${RING_LABEL[piece]} — click to take back`
            }
          >
            {piece === null ? (
              <span className="setup-empty">{i + 1}</span>
            ) : (
              <PieceGlyph kind={piece} />
            )}
          </button>
        ))}
      </div>

      <p className="muted" style={{ margin: "16px 0 8px" }}>
        {remaining.length > 0 ? "Pieces left to place:" : "All six placed."}
      </p>

      <div className="setup-tray">
        {remaining.map((piece, i) => (
          <button
            key={`${piece}-${i}`}
            className={held === piece ? "setup-slot filled held" : "setup-slot filled"}
            onClick={() => hold(piece)}
            disabled={pending}
            title={`Pick up a ${RING_LABEL[piece]} piece, then click a square`}
          >
            <PieceGlyph kind={piece} />
          </button>
        ))}
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

      <p className="muted" style={{ margin: "16px 0 8px" }}>
        Or start from an opening:
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

      <p className="muted" style={{ margin: "12px 0 0", lineHeight: 1.5 }}>
        Once confirmed this cannot be changed.
      </p>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * A small board piece.
 *
 * Carries its own gradient rather than referencing the board's: an SVG <defs>
 * is scoped to its own document fragment, so a url(#id) here would not resolve
 * against the board's definitions.
 */
function PieceGlyph({ kind }: { kind: number }) {
  return (
    <svg viewBox="-34 -34 68 68" width="34" height="34" aria-hidden>
      <defs>
        <radialGradient id="setup-piece-gradient" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0%" stopColor="var(--piece-light)" />
          <stop offset="55%" stopColor="var(--piece-mid)" />
          <stop offset="100%" stopColor="var(--piece-dark)" />
        </radialGradient>
      </defs>
      <circle
        r="32"
        fill="url(#setup-piece-gradient)"
        stroke="#3a2818"
        strokeWidth="1"
      />
      <circle r="26" fill="none" stroke="var(--piece-ring)" strokeWidth="2.5" />
      {kind >= 2 && (
        <circle r="19" fill="none" stroke="var(--piece-ring)" strokeWidth="2.5" />
      )}
      {kind >= 3 && (
        <circle r="12" fill="none" stroke="var(--piece-ring)" strokeWidth="2.5" />
      )}
    </svg>
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
            <circle cx={cx} cy={12} r={7} fill="none" stroke="var(--piece-ring)" strokeWidth="1.4" />
            {kind >= 2 && (
              <circle cx={cx} cy={12} r={4.6} fill="none" stroke="var(--piece-ring)" strokeWidth="1.4" />
            )}
            {kind >= 3 && (
              <circle cx={cx} cy={12} r={2.2} fill="none" stroke="var(--piece-ring)" strokeWidth="1.4" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
