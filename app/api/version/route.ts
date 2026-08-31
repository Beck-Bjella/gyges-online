import { NextResponse } from "next/server";
import { siteVersion } from "@/lib/db/queries";

/**
 * "Has anything changed on the site?"
 *
 * Polled by the lobby and the dashboard so a game created or joined elsewhere
 * appears without a manual reload. Returns one opaque string — enough to decide
 * whether a refresh is warranted, small enough to poll cheaply.
 *
 * Settling expired games here as well as on page render is deliberate: a lobby
 * left open should notice a game timing out, and this is the only request it
 * makes while idle.
 */
export async function GET() {
  return NextResponse.json({ v: siteVersion() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
