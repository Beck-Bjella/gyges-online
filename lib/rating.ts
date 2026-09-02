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
}

/**
 * The point spread of the whole ladder.
 *
 * Elo's usual 400 is not a law, it is a unit: the number of points that stands
 * for ten-to-one odds. Widening it and widening the anchors together spreads
 * the ladder out — a thousand points a rung instead of a few hundred — while
 * every win probability those gaps represent stays exactly where the measured
 * games put it. Changing the anchors ALONE would not do that; it would quietly
 * claim the strongest bot beats the weakest 99.9 times in a hundred, which is
 * not what the games say.
 *
 * So: change this and the anchors together, or neither.
 */
export const RATING_SCALE = 1200;

/**
 * Everyone starts at the bottom.
 *
 * Not a statistical prior to be revised — a floor to climb off. Nobody is
 * credited with a rating they have not won, so the number is only ever a
 * record of what someone has actually beaten. It also means the ladder needs
 * no notion of a provisional rating: a low number is not uncertainty, it is
 * the correct reading of having beaten nothing yet.
 */
export const START_RATING = 0;

/**
 * Early games move you further, so the climb out of the bottom is quick.
 *
 * Not a "provisional rating" — the number shown is always the real one. This
 * is only about how fast the arithmetic travels: everyone starts at zero on a
 * ladder five thousand points tall, and at a settled K that would take fifty
 * wins before the rating admitted what the first few already showed.
 *
 * The effect is that the first few results PLACE you and the rest refine you.
 * Five wins over the weakest bot takes you to the top of its rung; nine over
 * the strongest takes you to the top of the ladder. Both are the right answer
 * to what those results actually demonstrate.
 */
export const EARLY_GAMES = 12;

/**
 * How far above a bot beating it stops being worth anything.
 *
 * Chosen against the anchors rather than in the abstract: it must be strictly
 * SMALLER than the smallest gap between two bots, which is 900, or a rung's
 * ceiling reaches the next rung's rating and the ladder can be farmed one step
 * up. 750 leaves margin, and is about 80% expected on this scale — a result
 * you would get four times in five is barely evidence.
 *
 * An earlier version used a gap as wide as the rungs themselves, and the
 * tests caught what that costs: endless wins over the weakest bot drew level
 * with six honest wins over the middle one, which is the exact outcome this
 * mechanism exists to prevent. tests/rating.test.ts checks the relationship
 * against the real anchors, so retuning a bot into a smaller gap fails loudly
 * instead of quietly opening the ladder up.
 */
export const FARM_GAP = 750;

/**
 * How far one game can move you. Larger while the rating is still a guess, so
 * early games place you fast.
 *
 * Scaled with RATING_SCALE, since a step has to stay the same SHARE of the
 * ladder — otherwise a wider ladder would just converge three times slower.
 */
const K_EARLY = 900;
const K_SETTLED = 72;

/**
 * How far this game can move the rating.
 *
 * Decays smoothly from K_EARLY to K_SETTLED rather than stepping down at a
 * threshold. A step meant the twelfth game could still swing a player by
 * hundreds of points and the thirteenth by tens, so a run of losses arriving
 * late in the early phase erased a genuine win over a strong bot. Sliding the
 * weight down instead means the first results place you and each one after
 * matters a little less than the one before, which is what "settling" ought
 * to mean.
 */
function stepFor(gameNumber: number): number {
  const settled = Math.min(1, (gameNumber - 1) / EARLY_GAMES);
  return K_EARLY + (K_SETTLED - K_EARLY) * settled;
}

/**
 * Ratings do not go below this, which is where everyone starts.
 *
 * Losing to the weakest bot cannot put you below the bottom of the ladder,
 * because there is nothing below it to describe.
 */
const MIN_RATING = 0;

/** Elo's expected score for a player rated `rating` against `anchor`. */
export function expectedScore(rating: number, anchor: number): number {
  return 1 / (1 + Math.pow(10, (anchor - rating) / RATING_SCALE));
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

    const k = stepFor(games);
    const next = rating + k * ((won ? 1 : 0) - expectedScore(rating, anchor));

    // A win is also clamped AT the ceiling, not merely stopped once past it.
    // Without this the last win before the stop carries you a whole increment
    // beyond, which is enough to blur the boundary between two rungs.
    rating = won ? Math.min(next, ceiling) : Math.max(next, MIN_RATING);
  }

  return { rating: Math.round(rating), games };
}
