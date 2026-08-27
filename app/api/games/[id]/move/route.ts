import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { submitMove, GameError } from "@/lib/db/queries";
import type { Move } from "@/lib/game/board";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let move: Move;
  try {
    const body = (await req.json()) as { move?: unknown };
    if (!Array.isArray(body.move) || !body.move.every((n) => Number.isInteger(n))) {
      throw new Error("bad move");
    }
    move = body.move as Move;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const game = submitMove(id, user.id, move);
    return NextResponse.json({ game });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not submit that move." }, { status: 500 });
  }
}
