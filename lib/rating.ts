/**
 * The engine ladder: how far up the bots a player has got, as one number.
 *
 * ## Why this can exist when a human rating cannot yet
 *
 * A rating normally measures a pool, and needs a pool to measure against. The
 * bots are not a pool — they are fixed, known quantities that never improve,
 * never tire and are always available. So they can be used as *anchors*: each
 * bot is given a rating that never moves, and a player's rating is whatever
 * best explains their results against them. That works with one human on the
 * site, which is exactly what the human leaderboard cannot do.
 *
 * ## Why it cannot be farmed
 *
 * This is the whole design problem. The bots never get bored, so anything that
 * rewards *quantity* rewards sitting on the weakest one — points per win would
 * put a patient beginner above someone who beat the strongest bot.
 *
 * Two properties stop that:
 *
 * 1. **Elo already flattens.** Each win moves you by K × (1 − expected), and
 *    expected approaches 1 as you climb above an opponent, so wins over a weak
 *    bot buy less and less.
 * 2. **Above FARM_GAP, a win buys exactly nothing.** Flattening alone still
 *    creeps upward over thousands of games. A hard stop makes the ceiling
 *    real: beating a bot 400 below you teaches the ladder nothing it did not
 *    already know, so it changes nothing.
 *
 * Losses always count, at every gap. The asymmetry is deliberate — you cannot
 * grind upward, but you can always fall, which is what stops a rating from
 * being a trophy you keep by not playing.
 *
 * The consequence is the property that makes the ladder worth climbing, and it
 * is worth stating exactly, because the anchors have to keep it true:
 *
 *     a bot's farm ceiling (anchor + FARM_GAP) must sit BELOW the anchor of
 *     the next bot up
 *
 * When that holds — and tests/rating.test.ts checks it against the real
 * anchors — no amount of beating one bot can lift you to the rating of the
 * next. To go higher you must beat a better one. There is no other route.
 *
 * ## Derived, never stored
 *
 * Ratings are recomputed from finished games on every read, for the same
 * reason the human ones will be: a takeback un-finishes a game, and stored
 * ratings would need cascading reversals. Replayed, the game simply is not in
 * the list. It also means the anchors below can be re-tuned and every rating
 * on the site is correct on the next page load.
 */

/** A player's result against one bot, oldest first. */
export interface EngineResult {
  /** The bot's fixed rating. */
  anchor: number;
  won: boolean;
}

export interface EngineRating {
  rating: number;
  games: number;
  /** Too few games to mean much yet — shown, but marked. */
  provisional: boolean;
}

/**
 * Where a player starts, before any evidence.
 *
 * Between Novice and Casual: a beginner who loses to the weakest bot should
 * fall below it, and someone who beats a middling bot first time should not
 * have to climb from the basement to be placed correctly.
 */
export const START_RATING = 1000;

/** Under this many rated games the number is a guess, and says so. */
export const PROVISIONAL_GAMES = 5;

/**
 * How far above a bot beating it stops being worth anything.
 *
 * Chosen against the anchors rather than in the abstract: it must be strictly
 * SMALLER than the smallest gap between two bots, which is 300, or a rung's
 * ceiling reaches the next rung's rating and the ladder can be farmed one
 * step up. 250 leaves margin, and is about 80% expected — a result you would
 * get four times in five is barely evidence.
 *
 * It was 400 at first, which was too generous by exactly the amount that
 * mattered: endless wins over the weakest bot reached 1200, dead level with
 * six honest wins over Club. tests/rating.test.ts now checks the relationship
 * against the real anchors, so retuning a bot into a smaller gap fails loudly
 * instead of quietly opening the ladder up.
 */
export const FARM_GAP = 250;

/** Larger while the rating is still a guess, so early games place you fast. */
const K_PROVISIONAL = 40;
const K_SETTLED = 24;

/** Elo's expected score for a player rated `rating` against `anchor`. */
export function expectedScore(rating: number, anchor: number): number {
  return 1 / (1 + Math.pow(10, (anchor - rating) / 400));
}

/**
 * Replay a player's bot games in order and return where they end up.
 *
 * Pure: the same results always give the same rating, on any machine, which is
 * what lets this be recomputed rather than stored.
 */
export function engineRating(results: EngineResult[]): EngineRating {
  let rating = START_RATING;
  let games = 0;

  for (const { anchor, won } of results) {
    games++;
    const ceiling = anchor + FARM_GAP;

    // The farm stop: a win far above the opponent is not evidence. A loss
    // always is — especially that one.
    if (won && rating >= ceiling) continue;

    const k = games <= PROVISIONAL_GAMES ? K_PROVISIONAL : K_SETTLED;
    const next = rating + k * ((won ? 1 : 0) - expectedScore(rating, anchor));

    // A win is also clamped AT the ceiling, not merely stopped once past it.
    // Without this the last win before the stop carries you a whole increment
    // beyond, which is enough to blur the boundary between two rungs.
    rating = won ? Math.min(next, ceiling) : next;
  }

  return {
    rating: Math.round(rating),
    games,
    provisional: games < PROVISIONAL_GAMES,
  };
}
