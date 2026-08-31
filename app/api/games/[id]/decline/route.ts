import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { declineChallenge, GameError } from "@/lib/db/queries";

/** Turn a challenge down from its own page. The reserved game is deleted. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    declineChallenge(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not decline." }, { status: 500 });
  }
}
