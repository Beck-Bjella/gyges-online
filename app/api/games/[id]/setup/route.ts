import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { submitSetup, GameError } from "@/lib/db/queries";

/**
 * Place your six pieces on your home row.
 *
 * Body: { "arrangement": [3, 2, 1, 1, 2, 3] } — the ring counts in home-row
 * order, left to right from that player's own perspective.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let arrangement: number[];
  try {
    const body = (await req.json()) as { arrangement?: unknown };
    if (
      !Array.isArray(body.arrangement) ||
      !body.arrangement.every((n) => Number.isInteger(n))
    ) {
      throw new Error("bad arrangement");
    }
    arrangement = body.arrangement as number[];
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    return NextResponse.json({ game: submitSetup(id, user.id, arrangement) });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not place your pieces." }, { status: 500 });
  }
}
