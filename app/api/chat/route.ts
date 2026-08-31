import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  getGame,
  listChatMessages,
  postChatMessage,
  sideOf,
  GameError,
} from "@/lib/db/queries";

/**
 * Both chat scopes through one endpoint: `?game=<id>` is a game's private
 * chat, no parameter is the lobby.
 *
 * Reading the lobby needs nobody; reading a game's chat needs one of its two
 * players — the check lives here because listChatMessages deliberately does
 * not know who is asking. `after` is the last message id the client has, so a
 * quiet poll answers with an empty list and almost no bytes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const gameId = url.searchParams.get("game");
  const after = Number(url.searchParams.get("after") ?? 0) || 0;

  if (gameId !== null) {
    const user = await currentUser();
    const game = getGame(gameId);
    if (!game) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }
    if (!user || sideOf(game, user.id) === null) {
      return NextResponse.json(
        { error: "This chat belongs to the players." },
        { status: 403 },
      );
    }
  }

  const messages = listChatMessages(gameId, after).map((m) => ({
    id: m.id,
    name: m.username,
    body: m.body,
    at: m.created_at,
  }));
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to chat." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    game?: string | null;
    body?: string;
  };

  try {
    const m = postChatMessage(user.id, body.game ?? null, String(body.body ?? ""));
    return NextResponse.json({
      message: { id: m.id, name: m.username, body: m.body, at: m.created_at },
    });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not send that." }, { status: 500 });
  }
}
