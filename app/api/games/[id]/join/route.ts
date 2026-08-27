import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { joinGame, GameError } from "@/lib/db/queries";

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
    const game = joinGame(id, user.id);
    return NextResponse.json({ game });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not join." }, { status: 500 });
  }
}
