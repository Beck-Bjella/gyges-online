import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Hosts allowed to load dev-server assets.
   *
   * `next dev` serves /_next/static and /_next/hmr only to origins it trusts,
   * and that list is localhost by default. Open the site by LAN address —
   * which is the point of `npm run dev:lan`, and how a second player or a phone
   * reaches it — and Next.js returns 403 for the JavaScript bundle.
   *
   * The symptom is nasty precisely because the page still looks fine: the HTML
   * is server-rendered, so the board and the panels appear, but React never
   * hydrates and nothing responds to a click. Placing pieces, moving, signing
   * out — all silently inert, with no error in the page.
   *
   * Matching is by dot-separated segments with `*` / `**` wildcards; CIDR
   * ranges are NOT supported (see isCsrfOriginAllowed in next/dist/server/
   * app-render/csrf-protection.js), so a home network is covered by wildcarding
   * the last two octets of the usual private ranges.
   *
   * Development only — `next build` and `next start` ignore this entirely.
   */
  allowedDevOrigins: [
    // 192.168.x.x — the usual home router range.
    "192.168.*.*",
    // 10.x.x.x — common on larger or corporate networks.
    "10.*.*.*",
    // 172.16.x.x through 172.31.x.x, spelled out because the range is not a
    // clean wildcard.
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
    // Bonjour/mDNS names, e.g. "becks-pc.local".
    "*.local",
  ],
};

export default nextConfig;
