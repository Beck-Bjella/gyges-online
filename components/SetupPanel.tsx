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

import { useCallback, useMemo, useState } from "react";
import { SETUP_PIECES, type Player } from "@/lib/game/board";

interface Props {
  side: Player;
  pending: boolean;
  error: string | null;
  onSubmit: (arrangement: number[]) => void;
  /** Shown live on the board as the player arranges. */
  onPreview: (arrangement: (number | null)[]) => void;
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
  onSubmit,
  onPreview,
}: Props) {
  // slots[i] is the piece placed in home-row position i, or null.
  const [slots, setSlots] = useState<(number | null)[]>(Array(6).fill(null));

  const remaining = useMemo(() => {
    const left = [...SETUP_PIECES];
    for (const s of slots) {
      if (s === null) continue;
      const at = left.indexOf(s);
      if (at >= 0) left.splice(at, 1);
    }
    return left;
  }, [slots]);

  const update = useCallback(
    (next: (number | null)[]) => {
      setSlots(next);
      onPreview(next);
    },
    [onPreview],
  );

  const place = useCallback(
    (piece: number) => {
      const at = slots.indexOf(null);
      if (at === -1) return;
      const next = [...slots];
      next[at] = piece;
      update(next);
    },
    [slots, update],
  );

  const removeAt = useCallback(
    (i: number) => {
      const next = [...slots];
      next[i] = null;
      update(next);
    },
    [slots, update],
  );

  const reset = useCallback(() => update(Array(6).fill(null)), [update]);

  const standard = useCallback(() => update([...SETUP_PIECES]), [update]);

  const complete = slots.every((s) => s !== null);

  return (
    <div className="panel">
      <h2>Place your pieces</h2>
      <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
        Arrange your six pieces along your home row, left to right. You are
        player {side === 1 ? "1" : "2"}.
      </p>

      <div className="setup-slots">
        {slots.map((piece, i) => (
          <button
            key={i}
            className={piece === null ? "setup-slot" : "setup-slot filled"}
            onClick={() => piece !== null && removeAt(i)}
            disabled={pending}
            title={piece === null ? "empty" : `${RING_LABEL[piece]} — click to remove`}
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
            className="setup-slot filled"
            onClick={() => place(piece)}
            disabled={pending}
            title={`Place a ${RING_LABEL[piece]} piece`}
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
        <button className="btn" onClick={standard} disabled={pending}>
          Standard
        </button>
        <button
          className="btn"
          onClick={reset}
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
