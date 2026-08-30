/**
 * The engine's accounts.
 *
 * Bots are part of the application, not user data: they are defined here, in
 * code, and reconciled into the database on startup. Wiping the database and
 * starting again brings them straight back, and adding one is an edit to this
 * file rather than a manual insert someone has to remember to repeat on every
 * machine and every deployment.
 *
 * ## What a bot is
 *
 * An ordinary `users` row. That is the whole design — profiles, game history,
 * replay and the leaderboard are shared code that never asks whether a player
 * is a person. What distinguishes a bot is `bot_strength IS NOT NULL`, plus
 * the settings below.
 *
 * ## Reproducibility
 *
 * The engine runs in the player's browser, so the same bot would otherwise
 * play differently on different hardware — and a bot's win/loss record would
 * be a fact about its opponents' devices rather than about the bot.
 *
 * The fix is `maxNodes`: bound the search by WORK, not time. A phone and a
 * desktop then play the identical game, the phone just waits longer. This is
 * why `options` must always carry a node budget, and why a time limit would be
 * wrong here even though the engine supports one.
 *
 * `engineBuild` records which build the bot belongs to, because the browser
 * build fixes its transposition table and evaluation network at compile time.
 * A bot is only reproducible *within* a build.
 *
 * ## Changing a bot
 *
 * Editing a bot's settings changes how it plays, which makes its existing
 * record a record of a different opponent. So syncBots() will update a bot's
 * description freely, but treats its *settings* as immutable once it has
 * played: see the notes there. To meaningfully change a bot's strength, add a
 * new one and retire the old.
 */

import { getDb } from "./db/index.ts";
import { createBot, type BotSpec } from "./db/queries.ts";

/**
 * The engine build these bots play with.
 *
 * Bump this when shipping a browser engine that searches differently — a new
 * evaluation network, a different table size, changed search behaviour. Games
 * played against an earlier build keep that build recorded against them.
 */
export const ENGINE_BUILD = "v2.0.0-wasm-skill";

/**
 * Options every bot shares.
 *
 * `threads: 1` because WebAssembly has no threads without SharedArrayBuffer
 * and the cross-origin isolation headers it needs; the engine already defaults
 * to serial search, and this makes the intent explicit rather than incidental.
 */
const COMMON: Record<string, string | number | boolean> = {
  threads: 1,
  nn: true,
};

/**
 * The bots, weakest first.
 *
 * Each is a pair of dials, because neither alone makes a good opponent:
 *
 * - **`maxNodes`** is how hard it looks. It sets both how deep a trap has to be
 *   to beat it and how long the player waits, and it is the honest way to bound
 *   the search: a *depth* limit can take wildly different times in different
 *   positions, so the same bot would sometimes answer at once and sometimes
 *   sit there.
 * - **`skill`** is how well it chooses among what it found — the percentage of
 *   turns it plays the best move it saw, taking one of the next few otherwise.
 *
 * Turning only the first gives a bot that never errs, just misses deep ideas;
 * turning only the second gives one that sees everything and then fumbles at
 * random. The ladder moves both together, which is what makes the rungs feel
 * like different players rather than the same player handicapped.
 *
 * Times measured against this build on a desktop: 10k about half a second, 20k
 * 0.7s, 50k 1.7s, 100k 5.4s, 200k 14.7s. Note that is not a straight line — a
 * deeper search is slower per node, so doubling the budget more than doubles
 * the wait at the top of the ladder.
 *
 * A phone is two to four times slower again. Because the budget is work rather
 * than time, only the waiting changes, never the move.
 */
export const BOTS: BotSpec[] = [
  {
    username: "Helios-Novice",
    strength: 10,
    engineBuild: ENGINE_BUILD,
    description:
      "Barely looks ahead and often picks a worse move than it found. Where to start.",
    options: { ...COMMON, maxNodes: 10_000, skill: 25 },
  },
  {
    username: "Helios-Casual",
    strength: 30,
    engineBuild: ENGINE_BUILD,
    description: "Quick, and makes real mistakes you can punish.",
    options: { ...COMMON, maxNodes: 20_000, skill: 50 },
  },
  {
    username: "Helios-Club",
    strength: 60,
    engineBuild: ENGINE_BUILD,
    description: "Solid. Takes most of its chances, and punishes anything obvious.",
    options: { ...COMMON, maxNodes: 50_000, skill: 75 },
  },
  {
    username: "Helios-Sharp",
    strength: 85,
    engineBuild: ENGINE_BUILD,
    description: "Thinks properly and rarely slips. You will need a real idea.",
    options: { ...COMMON, maxNodes: 100_000, skill: 90 },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description: "No handicap at all. Expect a long wait, and a hard game.",
    options: { ...COMMON, maxNodes: 200_000, skill: 100 },
  },
];

/**
 * A controlled set for judging the skill dial on its own.
 *
 * Every one thinks exactly as hard — 50,000 nodes, about two seconds — so the
 * only thing that differs between them is how often they take the best move
 * they found. Playing two of these back to back isolates skill in a way the
 * ladder above cannot, because there both dials move at once.
 *
 * These are for testing. Delete the block and they stop being offered, though
 * the accounts and any games played against them stay — syncBots never removes
 * anything, on the grounds that deleting an account would blank out its
 * opponents' history.
 */
const SKILL_TEST_NODES = 50_000;

const SKILL_TESTS: BotSpec[] = [0, 25, 50, 75, 100].map((skill) => ({
  username: `Skill-${String(skill).padStart(3, "0")}`,
  // Ordered after the ladder so the two sets do not interleave in the list.
  strength: 100 + skill,
  engineBuild: ENGINE_BUILD,
  description:
    skill === 100
      ? "Test bot. Always its best move, at a fixed two seconds of thinking."
      : `Test bot. Best move ${skill}% of turns, at a fixed two seconds of thinking.`,
  options: { ...COMMON, maxNodes: SKILL_TEST_NODES, skill },
}));

BOTS.push(...SKILL_TESTS);

export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Bots whose settings differ from this file but which have already played. */
  frozen: string[];
}

/**
 * Bring the database's bots into line with BOTS.
 *
 * Safe to call on every start: existing bots are left alone unless their
 * description changed. Idempotent, and it never deletes — a bot removed from
 * this file keeps its account and its games, because deleting it would blank
 * out its opponents' history. Retire a bot by removing it from BOTS and, if it
 * should stop being offered, marking it deleted by hand.
 *
 * **Settings are frozen once a bot has played.** Changing `maxNodes` or
 * `strength` makes it a different opponent, so its existing record would no
 * longer describe the thing people beat. Such a change is reported rather than
 * applied; to actually change a bot's strength, add a new one under a new name.
 */
export function syncBots(): SyncResult {
  const db = getDb();
  const result: SyncResult = { created: [], updated: [], unchanged: [], frozen: [] };

  for (const spec of BOTS) {
    const existing = db
      .prepare(
        `SELECT id, username, bot_strength, bot_options, bot_description, bot_engine_build
           FROM users WHERE username_key = ?`,
      )
      .get(spec.username.toLowerCase()) as
      | {
          id: string;
          username: string;
          bot_strength: number | null;
          bot_options: string | null;
          bot_description: string | null;
          bot_engine_build: string | null;
        }
      | undefined;

    if (!existing) {
      createBot(spec);
      result.created.push(spec.username);
      continue;
    }

    // A human already holds this name. Leave them alone and say so — silently
    // converting someone's account into a bot would be much worse than a
    // missing bot.
    if (existing.bot_strength === null) {
      result.frozen.push(
        `${spec.username} (a player already has this name; the bot was not created)`,
      );
      continue;
    }

    const played = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM games
            WHERE (player1_id = ? OR player2_id = ?) AND status = 'finished'`,
        )
        .get(existing.id, existing.id) as { n: number }
    ).n;

    const wantOptions = JSON.stringify(spec.options);
    const settingsDiffer =
      existing.bot_strength !== spec.strength ||
      existing.bot_options !== wantOptions ||
      existing.bot_engine_build !== spec.engineBuild;

    if (settingsDiffer && played > 0) {
      // Its record describes the old settings. Report, do not rewrite history.
      result.frozen.push(
        `${spec.username} (settings changed but it has ${played} finished ` +
          `game(s); add a new bot instead of changing this one)`,
      );
      continue;
    }

    const descriptionDiffers = existing.bot_description !== (spec.description ?? null);
    if (!settingsDiffer && !descriptionDiffers) {
      result.unchanged.push(spec.username);
      continue;
    }

    db.prepare(
      `UPDATE users
          SET bot_strength = ?, bot_options = ?, bot_description = ?, bot_engine_build = ?
        WHERE id = ?`,
    ).run(
      spec.strength,
      wantOptions,
      spec.description ?? null,
      spec.engineBuild,
      existing.id,
    );
    result.updated.push(spec.username);
  }

  return result;
}
