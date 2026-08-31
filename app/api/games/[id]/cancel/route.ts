import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { cancelGame, GameError } from "@/lib/db/queries";

/** Withdraw an open table — creator only, and only before anyone joins. */
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
    cancelGame(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not cancel." }, { status: 500 });
  }
}
