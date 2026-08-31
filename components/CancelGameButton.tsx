"use client";

/**
 * Withdraw an open table from a dashboard row.
 *
 * The same route the game page's cancel uses; this is the short path, sitting
 * on the row so an abandoned table can be cleared without visiting it.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelGameButton({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const cancel = useCallback(async () => {
    if (!confirm("Cancel this game? It will be removed.")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/games/${gameId}/cancel`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }, [gameId, router]);

  return (
    <button className="btn" onClick={cancel} disabled={pending}>
      Cancel
    </button>
  );
}
