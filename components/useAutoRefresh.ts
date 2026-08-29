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
 * Not polling while the tab is hidden — that is nearly all of it. Five seconds
 * of visible watching is 720 requests an hour and 24 bytes each; hidden costs
 * nothing at all.
 *
 * Two earlier versions tried to be cleverer: growing the interval while nothing
 * happened, then a per-page interval chosen by what was being watched. Both
 * were dropped. Together they saved a few hundred requests a day against a
 * budget that was never close to a limit, and cost a conditional in the caller
 * plus three constants to keep straight. One interval everywhere is easier to
 * reason about and, at 25ms of server time per poll, cheap enough not to care.
 *
 * What is NOT an optimisation, and stays: `enabled`. A finished game and a
 * player mid-move must not be refreshed at all — the first has nothing to say,
 * the second would have its board replaced underneath it.
 */

/**
 * How often to ask, while the tab is being looked at.
 *
 * Five seconds is short enough that a move feels like it arrives, and long
 * enough that the cost stays irrelevant. One number, deliberately: every
 * attempt to vary it by context bought less than it complicated.
 */
const POLL_MS = 5000;

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
  options: { enabled?: boolean } = {},
): void {
  const { enabled = true } = options;
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

    const timer = setInterval(poll, POLL_MS);

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
  }, [url, enabled, router]);
}
