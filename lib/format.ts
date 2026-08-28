/** Small presentation helpers shared by the pages. */

export function relativeTime(unixSeconds: number, from = Date.now()): string {
  const delta = Math.floor(from / 1000) - unixSeconds;
  const future = delta < 0;
  const s = Math.abs(delta);

  let text: string;
  if (s < 60) text = "moments";
  else if (s < 3600) text = plural(Math.floor(s / 60), "minute");
  else if (s < 86400) text = plural(Math.floor(s / 3600), "hour");
  else if (s < 2592000) text = plural(Math.floor(s / 86400), "day");
  else text = plural(Math.floor(s / 2592000), "month");

  return future ? `in ${text}` : `${text} ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function describeTimeControl(seconds: number): string {
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day") + " per move";
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour") + " per move";
  if (seconds % 60 === 0) return plural(seconds / 60, "minute") + " per move";
  return plural(seconds, "second") + " per move";
}

/**
 * A think time, in the unit that suits its size.
 *
 * Stored in milliseconds, but correspondence moves take hours or days, so
 * that is what gets shown. Milliseconds is only the storage unit: keeping
 * precision costs nothing, and adding it later would be impossible.
 */
export function describeThinkTime(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
