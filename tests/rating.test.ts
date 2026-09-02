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

const {
  engineRating,
  expectedScore,
  START_RATING,
  FARM_GAP,
  RATING_SCALE,
} = await import("../lib/rating.ts");
const { BOTS } = await import("../lib/bots.ts");

const NOVICE = 1000;
const CASUAL = 1900;
const CLUB = 2900;
const FULL = 5000;

/** n games against one bot, all the same way. */
function run(anchor: number, won: boolean, n: number) {
  return Array.from({ length: n }, () => ({ anchor, won }));
}

test("expected score follows Elo, on this ladder's own scale", () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  // One scale-width is ten-to-one odds, whatever the scale happens to be.
  assert.ok(Math.abs(expectedScore(1500 + RATING_SCALE, 1500) - 0.909) < 0.001);
  assert.ok(Math.abs(expectedScore(1500 - RATING_SCALE, 1500) - 0.091) < 0.001);
});

test("the anchors still say what the measured games said", () => {
  // Widening the ladder must not change any of this: these are the results in
  // lib/bots.ts, and they are what the anchors were fitted to.
  const anchor = (name: string) => BOTS.find((b) => b.username === name)!.rating;

  const clubOverCasual = expectedScore(anchor("Helios-Club"), anchor("Helios-Casual"));
  assert.ok(
    clubOverCasual > 0.8 && clubOverCasual < 0.92,
    `Club over Casual was measured at 85%, ladder says ${Math.round(clubOverCasual * 100)}%`,
  );

  const sharpOverCasual = expectedScore(anchor("Helios-Sharp"), anchor("Helios-Casual"));
  assert.ok(
    sharpOverCasual > 0.95,
    `Sharp over Casual was measured at 100%, ladder says ${Math.round(sharpOverCasual * 100)}%`,
  );

  // And the order is the measured one, which is not the order of depth.
  const names = [...BOTS].sort((a, b) => a.rating - b.rating).map((b) => b.username);
  assert.deepEqual(names, [
    "Helios-Novice",
    "Helios-Casual",
    "Helios-Club",
    "Helios-Sharp",
    "Helios-Full",
  ]);
});

test("everyone starts at the bottom", () => {
  const r = engineRating([]);
  assert.equal(r.rating, START_RATING);
  assert.equal(r.rating, 0, "nobody is credited with a rating they have not won");
  assert.equal(r.games, 0);
});

test("a rating is only ever what was beaten", () => {
  // Losing to the weakest bot from the bottom leaves you at the bottom: there
  // is nothing below the ladder to fall to.
  assert.equal(engineRating(run(NOVICE, false, 20)).rating, 0);

  // And one win over the weakest is worth less than one over the strongest.
  assert.ok(
    engineRating(run(FULL, true, 1)).rating > engineRating(run(NOVICE, true, 1)).rating,
  );
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
    Math.abs(even.rating - CLUB) < 300,
    `an even record against Club should sit near ${CLUB}, got ${even.rating}`,
  );
});

test("beating the strongest bot puts you at the top of the ladder", () => {
  // A dozen wins over Full and you are reading five thousand-odd: the number
  // the ladder is worth climbing for. Elo approaches an anchor from below and
  // only passes it on sustained evidence, so this converges ON Full rather
  // than shooting past it.
  const dozen = engineRating(run(FULL, true, 12));
  assert.ok(
    dozen.rating > 4800,
    `a dozen wins over Full should read near 5000, got ${dozen.rating}`,
  );

  // Keep beating it and you do pass it — being better than Full is a claim
  // that takes more than a dozen games to earn.
  const sustained = engineRating(run(FULL, true, 60));
  assert.ok(
    sustained.rating > FULL,
    `sixty wins over Full should exceed it, got ${sustained.rating}`,
  );
  assert.ok(sustained.rating <= FULL + FARM_GAP, "and never past its ceiling");
});

test("each rung is a visibly different altitude", () => {
  // Settling on one bot and settling on the next must not look like the same
  // number — the spread is the point of the wide scale.
  const onCasual = engineRating(run(CASUAL, true, 200));
  const onClub = engineRating(run(CLUB, true, 200));
  assert.ok(
    onClub.rating - onCasual.rating > 500,
    `Club (${onClub.rating}) should be far above Casual (${onCasual.rating})`,
  );
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

test("a rating never goes negative, however badly it goes", () => {
  const wrecked = engineRating([...run(CLUB, true, 8), ...run(NOVICE, false, 500)]);
  assert.equal(wrecked.rating, 0, "the bottom of the ladder is the bottom");
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
