import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  botInGame,
  createBotGame,
  createChallenge,
  getGame,
  GameError,
} from "@/lib/db/queries";

/**
 * Play the same opponent again, from a finished game.
 *
 * Against the engine the new game starts at once — a bot needs no consent.
 * Against a person it becomes a challenge: an open game reserved for them,
 * which they accept from their dashboard. Either way the time control carries
 * over, and the answer is the new game's id to navigate to.
 */
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
    const game = getGame(id);
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "finished") throw new GameError("That game is not over.");
    const mine =
      game.player1_id === user.id
        ? game.player2_id
        : game.player2_id === user.id
          ? game.player1_id
          : null;
    if (mine === null) {
      throw new GameError("You are not a player in this game.", 403);
    }

    const bot = botInGame(game);
    const next = bot
      ? createBotGame(user.id, bot.id, game.move_seconds)
      : createChallenge(user.id, mine, game.move_seconds);
    return NextResponse.json({ id: next.id, challenged: bot === null });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not start a new game." }, { status: 500 });
  }
}
