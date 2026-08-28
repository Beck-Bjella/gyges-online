import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createGame, listOpenGames, settleExpiredGames } from "@/lib/db/queries";

export async function GET() {
  settleExpiredGames();
  return NextResponse.json({ games: listOpenGames() });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let moveSeconds = 259200;
  try {
    const body = (await req.json().catch(() => ({}))) as { moveSeconds?: unknown };
    if (typeof body.moveSeconds === "number" && body.moveSeconds > 0) {
      moveSeconds = Math.floor(body.moveSeconds);
    }
  } catch {
    // Body is optional; fall back to the default time control.
  }

  return NextResponse.json({ game: createGame(user.id, moveSeconds) }, { status: 201 });
}
