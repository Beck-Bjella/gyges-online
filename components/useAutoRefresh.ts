"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh the page when the server says something changed.
 *
 * Polling rather than a websocket: correspondence moves arrive minutes or days
 * apart, so holding a connection open per viewer would cost far more than it
 * saves. What makes polling cheap is that the probe is tiny — a few numbers,
 * about 50 bytes — and only a real change triggers the full refresh.
 *
 * ## Backing off
 *
 * A fixed five-second poll is right for the seconds after a move, when a reply
 * might land at any moment, and badly wrong for the hours after that. Left
 * open all day it is over seventeen thousand requests that all say "nothing
 * happened".
 *
 * So the interval grows while nothing changes — 5s, then 10, 20, up to a
 * minute — and snaps back to 5s the moment anything does, or when the tab is
 * brought back to the foreground. A player watching for a reply still sees it
 * within five seconds, because that is exactly when the interval is short.
 * Over a day of idling this is roughly a twelfth of the requests.
 *
 * Polling stops entirely when the tab is hidden, so a forgotten tab costs
 * nothing at all.
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
  options: { enabled?: boolean; minMs?: number; maxMs?: number } = {},
): void {
  const { enabled = true, minMs = 5000, maxMs = 60000 } = options;
  const router = useRouter();

  // Held in refs so changing them never restarts the timer — a restart would
  // reset the backoff and defeat the point.
  const currentRef = useRef(current);
  currentRef.current = current;
  const delayRef = useRef(minMs);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(run, delayRef.current);
    };

    async function run() {
      if (stopped || document.hidden) {
        schedule();
        return;
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          schedule();
          return;
        }
        const probe = ((await res.json()) as { v?: string }).v;
        if (probe === undefined) {
          schedule();
          return;
        }

        if (currentRef.current !== null && probe !== currentRef.current) {
          // Something moved. Refresh, and go back to watching closely.
          delayRef.current = minMs;
          if (!stopped) router.refresh();
        } else {
          // Nothing to report. Ask less often next time.
          delayRef.current = Math.min(delayRef.current * 2, maxMs);
        }
      } catch {
        // A failed poll is not worth surfacing; back off and try again.
        delayRef.current = Math.min(delayRef.current * 2, maxMs);
      }
      schedule();
    }

    // Coming back to the tab is the moment a player most wants to be current.
    const onVisible = () => {
      if (!document.hidden) {
        delayRef.current = minMs;
        if (timer) clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, enabled, minMs, maxMs, router]);
}
