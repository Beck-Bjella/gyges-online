/**
 * The engine ladder, assembled: games out of the database, anchors out of
 * lib/bots.ts, arithmetic out of lib/rating.ts.
 *
 * Computed on every read rather than stored. At this size that is one indexed
 * query and a few hundred multiplications — and it means a takeback, a retuned
 * bot or a changed anchor is reflected everywhere at once, with nothing to
 * migrate and nothing that can drift out of step with the games it claims to
 * describe.
 */

import { engineGamesForLadder } from "./db/queries.ts";
import { BOTS } from "./bots.ts";
import { engineRating, type EngineRating } from "./rating.ts";

export interface LadderEntry extends EngineRating {
  id: string;
  username: string;
  /** The strongest bot they have beaten, by anchor. Null if none yet. */
  bestBeaten: string | null;
  bestBeatenRating: number;
}

/** Anchor by bot name. A bot not in this map cannot be rated against. */
function anchors(): Map<string, number> {
  return new Map(BOTS.map((b) => [b.username, b.rating]));
}

/**
 * Everyone who has finished a rated game against the engine, best first.
 *
 * Ties break on fewer games, so the player who reached a rating in less
 * grinding is listed first — which is the same value the farm stop encodes.
 */
export function engineLadder(): LadderEntry[] {
  const anchor = anchors();
  const byPlayer = new Map<
    string,
    { username: string; results: { anchor: number; won: boolean }[]; best: number; bestName: string | null }
  >();

  for (const row of engineGamesForLadder()) {
    const rating = anchor.get(row.bot_username);
    // A retired bot has no anchor, so its games cannot be rated. Skipping them
    // is honest: the alternative is inventing a number for an opponent nobody
    // can play any more.
    if (rating === undefined) continue;

    let entry = byPlayer.get(row.user_id);
    if (!entry) {
      entry = { username: row.username, results: [], best: 0, bestName: null };
      byPlayer.set(row.user_id, entry);
    }
    const won = row.won === 1;
    entry.results.push({ anchor: rating, won });
    if (won && rating > entry.best) {
      entry.best = rating;
      entry.bestName = row.bot_username;
    }
  }

  const rows: LadderEntry[] = [];
  for (const [id, entry] of byPlayer) {
    rows.push({
      id,
      username: entry.username,
      bestBeaten: entry.bestName,
      bestBeatenRating: entry.best,
      ...engineRating(entry.results),
    });
  }

  return rows.sort((a, b) => b.rating - a.rating || a.games - b.games);
}

/** One player's place on it, or null if they have never finished a rated game. */
export function engineRatingFor(userId: string): LadderEntry | null {
  return engineLadder().find((r) => r.id === userId) ?? null;
}
