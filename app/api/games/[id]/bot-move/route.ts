import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  botInGame,
  decodeBoard,
  getGame,
  sideOf,
  submitMove,
  submitSetup,
  GameError,
} from "@/lib/db/queries";
import {
  botSetup,
  boardForEngine,
  boardToEngineString,
  moveFromEngine,
} from "@/lib/game/engine";

/**
 * Drive the engine's turn in a game against a bot.
 *
 * The search itself runs in the player's browser, so this endpoint is the two
 * ends of that round trip:
 *
 *   POST {}                -> "it is the bot's turn; search this position"
 *   POST { move: "5|9" }   -> "the engine answered; play it"
 *
 * ## Why the browser is allowed to speak for the bot
 *
 * It has to: the engine is a WebAssembly module running on the player's
 * machine, and the server has no engine of its own. What keeps that honest is
 * that **the bot's move is validated exactly like a human's** — it goes through
 * submitMove, which checks turn order and full move legality via
 * lib/game/rules.ts. A tampered client cannot make the bot play an illegal
 * move, put a piece anywhere it likes, or move out of turn.
 *
 * What a tampered client *can* do is make the bot play a legal but bad move,
 * and so beat it. That is inherent to running the engine client-side and is the
 * same trust model as any in-browser opponent; a player who wants to lose to
 * themselves can already do that by resigning. It does mean a bot's win/loss
 * record is a record of games as played, not a proof of the engine's strength.
 *
 * Both directions require the caller to be a participant, so a passer-by cannot
 * drive someone else's game.
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

  const game = getGame(id);
  if (!game) return NextResponse.json({ error: "Game not found." }, { status: 404 });

  // Only a player in this game may drive its bot.
  if (sideOf(game, user.id) === null) {
    return NextResponse.json(
      { error: "You are not a player in this game." },
      { status: 403 },
    );
  }

  const bot = botInGame(game);
  if (!bot) {
    return NextResponse.json(
      { error: "There is no engine in this game." },
      { status: 400 },
    );
  }

  const botSide = sideOf(game, bot.id);
  if (botSide === null) {
    return NextResponse.json({ error: "That bot is not seated." }, { status: 400 });
  }

  if (game.status !== "setup" && game.status !== "active") {
    return NextResponse.json({ error: "That game is not in progress." }, { status: 400 });
  }
  if (game.turn !== botSide) {
    return NextResponse.json({ error: "It is not the engine's turn." }, { status: 409 });
  }

  let body: { move?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as { move?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    // --- the bot's home row -------------------------------------------------
    //
    // Handled here rather than by the engine, which requires a full twelve
    // pieces before it will search. No round trip to the browser is needed.
    if (game.status === "setup") {
      const placed = submitSetup(id, bot.id, botSetup());
      return NextResponse.json({ done: true, game: placed });
    }

    // --- the engine answered ------------------------------------------------
    if (typeof body.move === "string") {
      const move = moveFromEngine(body.move, botSide);
      if (!move) {
        return NextResponse.json(
          { error: "The engine did not return a move." },
          { status: 400 },
        );
      }
      // submitMove is the same call a human's move makes: it re-checks whose
      // turn it is and whether the move is legal. Nothing here is trusted.
      const played = submitMove(id, bot.id, move);
      return NextResponse.json({ done: true, game: played });
    }

    // --- what should the engine search? -------------------------------------
    //
    // The board is handed over already oriented for the engine, which always
    // searches as player 1. The browser forwards this string verbatim and sends
    // back whatever the engine says; it never has to reason about sides.
    const oriented = boardForEngine(decodeBoard(game.board), botSide);
    return NextResponse.json({
      done: false,
      board: boardToEngineString(oriented),
      options: bot.bot_options ?? {},
      bot: {
        username: bot.username,
        strength: bot.bot_strength,
        engineBuild: bot.bot_engine_build,
      },
    });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "The engine's move failed." }, { status: 500 });
  }
}
