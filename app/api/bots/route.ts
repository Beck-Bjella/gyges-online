import { NextResponse } from "next/server";
import { botLeaderboard } from "@/lib/db/queries";

/**
 * The engine's accounts, as opponents to choose from.
 *
 * Public: which bots exist and how they are configured is not a secret, and a
 * player is entitled to know what they are playing before they start. The node
 * budget in particular is what decides how long they will be waiting.
 *
 * The pages get this straight from the database; this route exists for
 * programmatic clients and the smoke test.
 */
export async function GET() {
  const bots = botLeaderboard().map((b) => ({
    id: b.id,
    username: b.username,
    strength: b.strength,
    description: b.description,
    engineBuild: b.engine_build,
    options: b.options ? (JSON.parse(b.options) as Record<string, unknown>) : {},
    record: { wins: b.wins, losses: b.losses, draws: b.draws, played: b.played },
  }));
  return NextResponse.json({ bots });
}
