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
 * `maxNodes` is the strength-and-patience dial in one: it decides both how well
 * the bot plays and how long a player waits. An interrupted search is discarded
 * rather than resumed, so a budget nobody can afford to sit through is a bot
 * nobody can play.
 *
 * The times below were measured against this build searching the opening
 * position: roughly 26,000 nodes a second on a desktop. A phone is two to four
 * times slower, so the wait scales but — because the budget is work rather than
 * time — the move does not change.
 *
 *   maxPly 1      ~0.1s desktop   under a second anywhere
 *   20,000 nodes  ~0.8s desktop   ~3s phone
 *   60,000 nodes  ~2.3s desktop   ~9s phone
 *  200,000 nodes ~14.6s desktop  ~60s phone
 */
export const BOTS: BotSpec[] = [
  {
    // The shallowest search the engine can do: it looks one ply ahead and
    // stops, so it sees an immediate win or an immediate threat and nothing
    // beyond that. Bounded by depth rather than nodes — equally reproducible,
    // and it finishes in well under a second on any device.
    username: "Helios-Glance",
    strength: 5,
    engineBuild: ENGINE_BUILD,
    description:
      "Looks one move ahead and no further. The gentlest introduction there is.",
    options: { ...COMMON, maxPly: 1 },
  },
  {
    username: "Helios-Casual",
    strength: 20,
    engineBuild: ENGINE_BUILD,
    description: "Plays quickly and makes real mistakes. A good first opponent.",
    options: { ...COMMON, maxNodes: 20_000 },
  },
  {
    username: "Helios-Club",
    strength: 55,
    engineBuild: ENGINE_BUILD,
    description: "Solid. Punishes anything obvious.",
    options: { ...COMMON, maxNodes: 60_000 },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description: "The deepest search on offer. Expect a long wait on a phone.",
    options: { ...COMMON, maxNodes: 200_000 },
  },
];

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
