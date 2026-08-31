import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { abandonGame, GameError } from "@/lib/db/queries";

/** Walk away from a game still in setup. The game is deleted, stats untouched. */
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
    abandonGame(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not abandon." }, { status: 500 });
  }
}
