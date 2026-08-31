import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  createBotGame,
  createGame,
  listOpenGames,
  GameError,
} from "@/lib/db/queries";

export async function GET() {
  return NextResponse.json({ games: listOpenGames() });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let moveSeconds = 259200;
  let botId: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      moveSeconds?: unknown;
      botId?: unknown;
    };
    if (typeof body.moveSeconds === "number" && body.moveSeconds > 0) {
      moveSeconds = Math.floor(body.moveSeconds);
    }
    if (typeof body.botId === "string" && body.botId) botId = body.botId;
  } catch {
    // Body is optional; fall back to the default time control.
  }

  try {
    // With a bot named, the second seat is filled immediately — there is no
    // lobby step, because a bot does not browse for games.
    const game = botId
      ? createBotGame(user.id, botId, moveSeconds)
      : createGame(user.id, moveSeconds);
    return NextResponse.json({ game }, { status: 201 });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not create the game." }, { status: 500 });
  }
}
