"use client";

import { useCallback, useMemo, useState } from "react";
import { SETUP_PIECES } from "@/lib/game/board";

/**
 * The home row a player is building, before it is sent.
 *
 * Lifted out of SetupPanel because the arrangement is now made in two places at
 * once — the panel's tray and the board itself — and both need the same six
 * slots. A component that owned the state could only ever be edited from inside
 * itself.
 *
 * `slots[i]` is the piece in home-row position i counting from the player's own
 * left, which is exactly the order applySetup expects, so no mapping is needed
 * when it is submitted.
 */
export interface SetupSlots {
  slots: (number | null)[];
  /** Pieces not yet placed, in a stable order. */
  remaining: number[];
  /** The piece picked up from the tray, waiting for a square. */
  held: number | null;
  /** Pick a tray piece up, or put it back down by choosing it again. */
  hold: (piece: number | null) => void;
  /**
   * Act on home-row position i.
   *
   * Filled: the piece goes back to the tray. Empty: the held piece lands there,
   * or the next unplaced one if nothing is held — so a player who has not
   * realised they can pick pieces up first still gets a sensible result.
   */
  placeAt: (i: number) => void;
  /**
   * A specific piece dropped on home-row position i.
   *
   * Whatever was already there goes back to the tray, so a row can be rearranged
   * freely right up until it is confirmed.
   */
  dropAt: (i: number, piece: number) => void;
  clear: () => void;
  /** Replace the whole row, for the named openings. */
  choose: (slots: number[]) => void;
  complete: boolean;
}

export function useSetupSlots(
  onPreview: (slots: (number | null)[]) => void,
): SetupSlots {
  const [slots, setSlots] = useState<(number | null)[]>(Array(6).fill(null));
  const [held, setHeld] = useState<number | null>(null);

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

  const placeAt = useCallback(
    (i: number) => {
      const next = [...slots];
      if (next[i] !== null) {
        next[i] = null;
        update(next);
        return;
      }
      const piece = held ?? remaining[0];
      if (piece === undefined) return;
      // Only if that piece is actually still available — `held` survives a
      // click elsewhere, and putting a seventh piece down would be silently
      // rejected by the server.
      if (!remaining.includes(piece)) return;
      next[i] = piece;
      setHeld(null);
      update(next);
    },
    [slots, held, remaining, update],
  );

  const dropAt = useCallback(
    (i: number, piece: number) => {
      if (!remaining.includes(piece)) return;
      const next = [...slots];
      next[i] = piece;
      setHeld(null);
      update(next);
    },
    [slots, remaining, update],
  );

  return {
    slots,
    remaining,
    dropAt,
    held,
    hold: useCallback(
      (piece: number | null) => setHeld((h) => (h === piece ? null : piece)),
      [],
    ),
    placeAt,
    clear: useCallback(() => {
      setHeld(null);
      update(Array(6).fill(null));
    }, [update]),
    choose: useCallback(
      (next: number[]) => {
        setHeld(null);
        update([...next]);
      },
      [update],
    ),
    complete: slots.every((s) => s !== null),
  };
}
