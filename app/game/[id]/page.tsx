import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  getGame,
  getMoves,
  settleExpiredGames,
  botInGame,
  sideOf,
  decodeBoard,
} from "@/lib/db/queries";
import { moveFromString } from "@/lib/game/board";
import GameView from "@/components/GameView";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  settleExpiredGames();

  const game = getGame(id);
  if (!game) notFound();

  const user = await currentUser();
  const moves = getMoves(id);
  // Which player, if either, is the engine. The client needs this to know when
  // to run a search; it is never trusted for anything else.
  const bot = botInGame(game);

  return (
    <GameView
      game={{
        id: game.id,
        status: game.status,
        turn: game.turn,
        result: game.result,
        resultReason: game.result_reason,
        takebackOffered: game.takeback_offered === 1,
        ply: game.ply,
        moveSeconds: game.move_seconds,
        deadlineAt: game.deadline_at,
        updatedAt: game.updated_at,
        player1Name: game.player1_name,
        player2Name: game.player2_name,
        hasPlayer2: game.player2_id !== null,
        botSide: bot ? sideOf(game, bot.id) : null,
        botName: bot?.username ?? null,
      }}
      board={decodeBoard(game.board)}
      startBoard={decodeBoard(game.start_board)}
      history={moves.map((m) => ({
        ply: m.ply,
        player: m.player,
        kind: m.kind,
        // A setup ply records six ring counts ("321123"), not board indices.
        move:
          m.kind === "setup"
            ? Array.from(m.move, Number)
            : moveFromString(m.move),
        boardAfter: decodeBoard(m.board_after),
        thinkMs: m.think_ms,
      }))}
      viewerSide={sideOf(game, user?.id ?? null)}
      signedIn={Boolean(user)}
    />
  );
}
