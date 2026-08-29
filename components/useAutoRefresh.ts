"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh the page when the server says something changed.
 *
 * Polling rather than a websocket: correspondence moves arrive minutes or days
 * apart, so holding a connection open per viewer would cost far more than it
 * saves — and serverless hosting cannot hold one anyway. What makes polling
 * cheap is that the probe is tiny, about 24 bytes, and only a real change
 * triggers the full refresh.
 *
 * ## What keeps the cost down
 *
 * Not polling while the tab is hidden. That is nearly all of it: a tab open all
 * day but looked at for an hour makes 720 requests instead of 17,280. An
 * earlier version of this also grew the interval while nothing happened, which
 * saved a further 359 requests a day and cost sixty lines of interval-doubling.
 * It was removed; the caller picks an interval to suit what it is watching,
 * which is easier to reason about and very nearly as cheap.
 */
export function useAutoRefresh(
  /**
   * The probe URL. Must be cheap: it is fetched, not rendered, and must answer
   * with `{ v: "<version>" }`.
   */
  url: string,
  /**
   * The version as the page was rendered with it. When the probe reports
   * something different, the page is refreshed.
   */
  current: string | null,
  options: { enabled?: boolean; everyMs?: number } = {},
): void {
  const { enabled = true, everyMs = 5000 } = options;
  const router = useRouter();

  // Held in a ref so a new value never restarts the timer.
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;

    async function poll() {
      // A hidden tab costs nothing. This is the whole saving.
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const probe = ((await res.json()) as { v?: string }).v;
        if (probe === undefined || currentRef.current === null) return;
        if (probe !== currentRef.current && !stopped) router.refresh();
      } catch {
        // A failed poll is not worth surfacing; the next one will retry.
      }
    }

    const timer = setInterval(poll, everyMs);

    // Coming back to the tab is the moment a player most wants to be current,
    // and it is also when the poll has been asleep the longest.
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, enabled, everyMs, router]);
}
