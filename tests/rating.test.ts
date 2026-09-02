/**
 * The engine ladder's arithmetic.
 *
 * The property under test is the one the whole feature rests on: the bots are
 * always available and never tire, so a ladder that rewards persistence is a
 * ladder that measures persistence. Beating a weak bot forever must not lift
 * you past a strong one.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { engineRating, expectedScore, START_RATING, PROVISIONAL_GAMES, FARM_GAP } =
  await import("../lib/rating.ts");
const { BOTS } = await import("../lib/bots.ts");

const NOVICE = 800;
const CLUB = 1450;
const FULL = 2200;

/** n games against one bot, all the same way. */
function run(anchor: number, won: boolean, n: number) {
  return Array.from({ length: n }, () => ({ anchor, won }));
}

test("expected score follows Elo's own scale", () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  // 400 points is about nine wins in ten — the scale FARM_GAP is chosen on.
  assert.ok(Math.abs(expectedScore(1900, 1500) - 0.909) < 0.001);
  assert.ok(Math.abs(expectedScore(1100, 1500) - 0.091) < 0.001);
});

test("a player with no games sits at the starting rating", () => {
  const r = engineRating([]);
  assert.equal(r.rating, START_RATING);
  assert.equal(r.games, 0);
  assert.ok(r.provisional);
});

test("beating a stronger bot raises you more than beating a weaker one", () => {
  const weak = engineRating(run(NOVICE, true, 1));
  const strong = engineRating(run(FULL, true, 1));
  assert.ok(
    strong.rating > weak.rating,
    `beating Full (${strong.rating}) should beat beating Novice (${weak.rating})`,
  );
});

test("farming the weakest bot cannot lift you past its ceiling", () => {
  // Ten thousand wins over the weakest bot. If quantity worked, this would be
  // the top of the ladder.
  const farmed = engineRating(run(NOVICE, true, 10_000));

  assert.ok(
    farmed.rating <= NOVICE + FARM_GAP,
    `farming stopped at ${farmed.rating}, must not exceed ${NOVICE + FARM_GAP}`,
  );
  assert.equal(farmed.games, 10_000, "the games still count as games played");
});

test("a farmer never overtakes someone who beat a strong bot a few times", () => {
  const farmer = engineRating(run(NOVICE, true, 10_000));
  const climber = engineRating(run(CLUB, true, 6));

  assert.ok(
    climber.rating > farmer.rating,
    `six wins over Club (${climber.rating}) must beat 10,000 over Novice (${farmer.rating})`,
  );
});

test("to climb you must beat a better bot", () => {
  // Settle against Novice, then start beating Club: the number moves again.
  const settled = engineRating(run(NOVICE, true, 500));
  const promoted = engineRating([...run(NOVICE, true, 500), ...run(CLUB, true, 5)]);
  assert.ok(
    promoted.rating > settled.rating + 50,
    `Club wins should move a Novice-farmed rating (${settled.rating} -> ${promoted.rating})`,
  );
});

test("losses always count, however far below you the bot is", () => {
  const ceiling = engineRating(run(NOVICE, true, 10_000));
  const humbled = engineRating([...run(NOVICE, true, 10_000), ...run(NOVICE, false, 3)]);
  assert.ok(
    humbled.rating < ceiling.rating - 20,
    `losing to Novice must hurt (${ceiling.rating} -> ${humbled.rating})`,
  );
});

test("a rating converges near the bot it can just about beat", () => {
  // Half the games against Club, won and lost alternately: the honest reading
  // of that record is "about as good as Club".
  const even = engineRating(
    Array.from({ length: 200 }, (_, i) => ({ anchor: CLUB, won: i % 2 === 0 })),
  );
  assert.ok(
    Math.abs(even.rating - CLUB) < 120,
    `an even record against Club should sit near ${CLUB}, got ${even.rating}`,
  );
});

test("the rating stops being provisional once there are enough games", () => {
  assert.ok(engineRating(run(CLUB, true, PROVISIONAL_GAMES - 1)).provisional);
  assert.ok(!engineRating(run(CLUB, true, PROVISIONAL_GAMES)).provisional);
});

test("no bot's farm ceiling reaches the next bot's rating", () => {
  // The invariant the whole ladder rests on, checked against the real
  // anchors: if someone retunes a bot and closes a gap below FARM_GAP, this
  // fails rather than quietly making a rung farmable into the next one.
  const anchors = BOTS.map((b) => b.rating).sort((a, b) => a - b);
  for (let i = 0; i < anchors.length - 1; i++) {
    const ceiling = anchors[i] + FARM_GAP;
    assert.ok(
      ceiling < anchors[i + 1],
      `farming ${anchors[i]} reaches ${ceiling}, which is not below ${anchors[i + 1]}`,
    );
  }
});

test("the same results always give the same rating", () => {
  const results = [
    { anchor: NOVICE, won: true },
    { anchor: CLUB, won: false },
    { anchor: CLUB, won: true },
    { anchor: FULL, won: false },
  ];
  assert.equal(engineRating(results).rating, engineRating(results).rating);
});
