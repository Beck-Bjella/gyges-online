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
 * **None of these is easy, and that is deliberate.** Every one of them refuses
 * to hand you the game: `skill-allowLosing` is off throughout, so no bot will
 * ever play a move the search has already proven loses. Beating any of them
 * means actually trapping it. The ladder is how *thoroughly* you have to.
 *
 * Two settings, two values each, which is the whole design:
 *
 * - **`maxPly`** — 1 or 3. At one ply it sees only what is already on the
 *   board, so a two-move idea gets through. At three it sees your reply and
 *   its own answer, and has to be trapped properly.
 * - **`skill-weakness`** with **`skill-reach`** — 85/60 or off. Weakness
 *   forgives part of the gap between a move and the best one, so a slightly
 *   worse move is easy to land on and a much worse one is not. `reach` sets
 *   the unit that is measured in, as a share of the ranked list, and the two
 *   have to move together: measured against only the top few moves, weakness
 *   has nothing to spend and the bot plays its best move whatever it is set to.
 *
 * Depth cannot be the ladder on its own here. Iterative deepening runs odd
 * plies only, so `maxPly: 2` is really 1, and 5 is both near-unbeatable and
 * slow in some positions. Two usable depths, so weakness supplies the rest.
 *
 * The last bot is bounded by nodes rather than depth, which is a different
 * thing again: 200,000 nodes reaches three ply in a crowded opening and far
 * deeper in a sparse endgame, so it gets stronger exactly as the game
 * simplifies. Unbeatable is the point of it.
 *
 * Times on a desktop: the ply-bounded four answer in well under a second
 * typically, worst case a couple of seconds; the node-bounded one takes about
 * fifteen. A phone is two to four times slower, and because the bound is work
 * rather than seconds, only the waiting changes — never the move.
 */
const WEAK = {
  "skill-weakness": 85,
  "skill-reach": 60,
};

export const BOTS: BotSpec[] = [
  {
    username: "Helios-Novice",
    strength: 20,
    engineBuild: ENGINE_BUILD,
    description:
      "Looks one move ahead and often picks a poor one. It still will not hand you the game.",
    options: { ...COMMON, maxPly: 1, ...WEAK },
  },
  {
    username: "Helios-Club",
    strength: 40,
    engineBuild: ENGINE_BUILD,
    description:
      "Looks one move ahead and plays the best it finds. A two-move idea still gets through.",
    options: { ...COMMON, maxPly: 1 },
  },
  {
    username: "Helios-Sharp",
    strength: 60,
    engineBuild: ENGINE_BUILD,
    description:
      "Sees your reply and its own answer, but chooses poorly. Trap it thoroughly.",
    options: { ...COMMON, maxPly: 3, ...WEAK },
  },
  {
    username: "Helios-Master",
    strength: 80,
    engineBuild: ENGINE_BUILD,
    description:
      "Three ply, no handicap. You will need a plan it cannot see the end of.",
    options: { ...COMMON, maxPly: 3 },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description:
      "No limit but work. Searches deepest exactly when the position simplifies. Expect a wait.",
    options: { ...COMMON, maxNodes: 200_000 },
  },
];

export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Bots dropped from this file, hidden but not destroyed. */
  retired: string[];
  /** Bots that could not be synced at all, with the reason. */
  frozen: string[];
}

/**
 * Bring the database's bots into line with BOTS.
 *
 * Safe to call on every start: existing bots are left alone unless their
 * description changed. Idempotent, and it never deletes — a bot removed from
 * this file is retired rather than destroyed — `deleted_at` is set, so it stops
 * being offered while its account and games survive and an opponent's history
 * still resolves. Listing it again brings it back.
 *
 * **A bot's settings always follow this file**, even once it has played. That
 * is wrong for a live site — changing what a bot does makes its existing record
 * a record of a different opponent — and it is right for now, because the bots
 * are still being tuned and every change would otherwise mean wiping the
 * database. Restore the guard before anyone's games are worth keeping.
 */
export function syncBots(): SyncResult {
  const db = getDb();
  const result: SyncResult = {
    created: [],
    updated: [],
    unchanged: [],
    retired: [],
    frozen: [],
  };

  // Hide any bot no longer listed above. Reshaping the ladder used to leave the
  // old rungs behind, still offered and still carrying whatever settings they
  // had — which is worse than either keeping or removing them.
  //
  // Soft, via deleted_at, never a DELETE: the account and its games survive, so
  // an opponent's history still resolves. Listing the bot again un-retires it.
  const wanted = BOTS.map((b) => b.username.toLowerCase());
  const stale = db
    .prepare(
      `SELECT id, username FROM users
        WHERE bot_strength IS NOT NULL AND deleted_at IS NULL
          AND username_key NOT IN (${wanted.map(() => "?").join(", ")})`,
    )
    .all(...wanted) as { id: string; username: string }[];
  for (const bot of stale) {
    db.prepare(`UPDATE users SET deleted_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      bot.id,
    );
    result.retired.push(bot.username);
  }

  for (const spec of BOTS) {
    const existing = db
      .prepare(
        `SELECT id, username, bot_strength, bot_options, bot_description,
              bot_engine_build, deleted_at
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
          deleted_at: string | null;
        }
      | undefined;

    if (existing?.deleted_at) {
      // Listed again after being dropped: bring it back rather than refusing
      // the name.
      db.prepare(`UPDATE users SET deleted_at = NULL WHERE id = ?`).run(existing.id);
      existing.deleted_at = null;
    }

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
