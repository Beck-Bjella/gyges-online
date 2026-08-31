import { NextResponse } from "next/server";
import { gameVersion } from "@/lib/db/queries";

/**
 * "Has this game changed?"
 *
 * The game page polls this every few seconds so a player sees their
 * opponent's move without reloading. It returns only the ply, status and
 * updated time — enough to decide whether a refresh is warranted, and small
 * enough to poll cheaply.
 *
 * Polling rather than a websocket is a deliberate choice: correspondence
 * moves arrive minutes or days apart, so a persistent connection per viewer
 * would cost far more than it saves. See docs/ARCHITECTURE.md.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const version = gameVersion(id);
  if (!version) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  // The same `{ v }` shape the site-wide probe uses, so one polling hook
  // serves both. The parts are joined rather than sent as fields because the
  // caller only ever compares them for equality.
  return NextResponse.json(
    { v: [version.ply, version.status, version.updated_at].join(":") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
