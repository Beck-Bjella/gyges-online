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
 * The fix is to bound the search by WORK, not time — `maxPly` or `maxNodes`. A
 * phone and a desktop then play the identical game, the phone just waits
 * longer. This is why `options` must always carry one of those bounds, and why
 * a time limit would be wrong here even though the engine supports one.
 *
 * `engineBuild` records which build the bot belongs to, because the browser
 * build fixes its transposition table and evaluation network at compile time.
 * A bot is only reproducible *within* a build.
 *
 * ## Changing a bot
 *
 * Edit it here and it changes, including after it has played. Strictly this
 * makes its existing record a record of a different opponent, and on a live
 * site that would matter — but the bots are still being tuned, and a guard
 * against it meant wiping the database after every game. See syncBots().
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
export const ENGINE_BUILD = "v3.0.0-wasm-skill-options";

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
 * **Every one looks exactly three ply ahead.** A node budget was tried first,
 * at 50,000 for all of them, and the problem showed up in endgames: 50,000
 * nodes reaches five to seven ply, which is enough to see the whole position,
 * so when only one move avoided losing the engine always found it. Capping
 * depth instead makes the horizon short on purpose. Three ply is one move each
 * and one more — enough to answer an immediate threat, not enough to see a
 * trap being set.
 *
 * Bounding by depth was avoided earlier because a low ply can take unpredictable
 * time in a tactical position. Measured across a real game at ply 3: median
 * 0.17s a move, worst case 2.4s. That concern is real further up and does not
 * bite here.
 *
 * Two things move together up the ladder: how often it plays the best move, and
 * how bad the move is when it does not. Accuracy alone was not enough — with an
 * accurate evaluation the 4th-best move is still a good move, so a bot that
 * never played its best move was still hard to beat.
 *
 * - **`skill-poolFrom` / `skill-poolTo`** — which slice of the ranked list a
 *   slip lands in, as a percent of however many moves the position offers. A
 *   share rather than fixed ranks, so "middling move" means the same thing
 *   whether there are six replies or eighteen. Never includes the best move,
 *   so accuracy alone decides whether that gets played.
 * **None of them can throw a game.** `skill-allowLosing` is left off, so moves
 * the search sees as a forced loss are never choosable. Every bot here is safe
 * within its horizon: it will not hand you the game, and beating it means
 * outplaying it or finding something deeper than 50,000 nodes sees.
 *
 * That was tried the other way first, and the reason it works now is the window.
 * With `allowLosing` off and a pool of the top few, every alternative was
 * another good move and the weakest bot was still hard — threaten it and it
 * answers every time. The window reaches genuinely bad moves without needing
 * losing ones, which is what makes "worse, but never suicidal" expressible.
 *
 * Leaving it off also means the search prunes normally. Turning it on disables
 * two prunes, so the node budget gets spent on refuted lines — measured as the
 * same move with a different evaluation in about one position in six.
 *
 * A phone is two to four times slower. Because the bound is depth rather than
 * seconds, only the waiting changes, never the move.
 */
const MAX_PLY = 3;

/** Settings shared by every handicapped bot. */
const HANDICAP = {
  maxPly: MAX_PLY,
};

export const BOTS: BotSpec[] = [
  {
    username: "Helios-Novice",
    strength: 20,
    engineBuild: ENGINE_BUILD,
    description:
      "Never plays the best move it found, and usually one of its worst. Where to start.",
    options: {
      ...COMMON,
      ...HANDICAP,
      "skill-accuracy": 0,
      "skill-poolFrom": 50,
      "skill-poolTo": 100,
    },
  },
  {
    username: "Helios-Casual",
    strength: 40,
    engineBuild: ENGINE_BUILD,
    description: "Finds the right move about a fifth of the time. Very punishable.",
    options: {
      ...COMMON,
      ...HANDICAP,
      "skill-accuracy": 20,
      "skill-poolFrom": 35,
      "skill-poolTo": 80,
    },
  },
  {
    username: "Helios-Club",
    strength: 60,
    engineBuild: ENGINE_BUILD,
    description: "Right about half the time, and the rest are visibly worse.",
    options: {
      ...COMMON,
      ...HANDICAP,
      "skill-accuracy": 45,
      "skill-poolFrom": 20,
      "skill-poolTo": 60,
    },
  },
  {
    username: "Helios-Sharp",
    strength: 80,
    engineBuild: ENGINE_BUILD,
    description: "Slips about one turn in three, but only slightly. You will need a real idea.",
    options: {
      ...COMMON,
      ...HANDICAP,
      "skill-accuracy": 70,
      "skill-poolFrom": 5,
      "skill-poolTo": 30,
    },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description: "No handicap at all. Always its best move.",
    options: { ...COMMON, maxPly: MAX_PLY, "skill-accuracy": 100 },
  },
];

export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Bots that could not be synced at all, with the reason. */
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
 * **A bot's settings always follow this file**, even once it has played. That
 * is wrong for a live site — changing what a bot does makes its existing record
 * a record of a different opponent — and it is right for now, because the bots
 * are still being tuned and every change would otherwise mean wiping the
 * database. Restore the guard before anyone's games are worth keeping.
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

    const wantOptions = JSON.stringify(spec.options);
    const settingsDiffer =
      existing.bot_strength !== spec.strength ||
      existing.bot_options !== wantOptions ||
      existing.bot_engine_build !== spec.engineBuild;

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
