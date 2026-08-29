"use client";

import { useAutoRefresh } from "./useAutoRefresh";

/**
 * Keeps a server-rendered page current without a manual reload.
 *
 * Renders nothing. It exists so a page that is otherwise entirely server
 * components can opt into polling by dropping one element in, rather than
 * becoming a client component itself.
 *
 * `version` is the probe's answer at the moment the page was rendered; when
 * the probe starts saying something else, the page refreshes. Pass it as a
 * string so the comparison is a plain equality check and the page decides for
 * itself what "changed" means.
 */
export default function AutoRefresh({
  url = "/api/version",
  version,
  everyMs,
}: {
  url?: string;
  version: string;
  everyMs?: number;
}) {
  useAutoRefresh(url, version, { everyMs });
  return null;
}
