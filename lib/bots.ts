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
 * Four independent settings, not one strength number. There is no honest scale
 * running from "beginner" to "engine" — the search is far past a human even at
 * three ply — so rather than invent one, each bot is a hand-picked combination
 * and the settings say plainly what it does.
 *
 * - **`maxNodes`** — how hard it looks. Also what the player waits for, and the
 *   honest way to bound a search: a *depth* limit takes wildly different times
 *   in different positions, so the same bot would sometimes answer at once and
 *   sometimes sit there.
 * - **`skill-accuracy`** — the percentage of turns it plays the best move it
 *   found.
 * - **`skill-movePool`** — how many alternatives it chooses among on the other
 *   turns. Counted *below* the best move, so accuracy alone decides whether the
 *   best move gets played and the two settings stay independent.
 * - **`skill-allowLosing`** — whether moves that lose outright are among those
 *   alternatives. This is the one that decides whether a bot can be beaten by a
 *   threat it can see. Without it a bot errs constantly and still never hangs a
 *   game: every one of its alternatives is another sound reply, so a player can
 *   threaten repeatedly and watch all of them get answered.
 *
 * Times measured against this build on a desktop: 10k about half a second, 20k
 * 0.7s, 50k 1.7s, 100k 5.4s, 200k 14.7s. Not a straight line — a deeper search
 * is slower per node, so doubling the budget more than doubles the wait at the
 * top. A phone is two to four times slower again; because the budget is work
 * rather than time, only the waiting changes, never the move.
 */
export const BOTS: BotSpec[] = [
  {
    username: "Helios-Novice",
    strength: 10,
    engineBuild: ENGINE_BUILD,
    description:
      "Never plays the best move it found, and will walk into a threat. Where to start.",
    options: {
      ...COMMON,
      maxNodes: 10_000,
      "skill-accuracy": 0,
      "skill-movePool": 5,
      "skill-allowLosing": true,
    },
  },
  {
    username: "Helios-Casual",
    strength: 30,
    engineBuild: ENGINE_BUILD,
    description: "Quick, loose, and can still lose a game outright. Punishable.",
    options: {
      ...COMMON,
      maxNodes: 20_000,
      "skill-accuracy": 25,
      "skill-movePool": 4,
      "skill-allowLosing": true,
    },
  },
  {
    username: "Helios-Club",
    strength: 60,
    engineBuild: ENGINE_BUILD,
    description: "Finds the right move half the time, and blunders the rest.",
    options: {
      ...COMMON,
      maxNodes: 50_000,
      "skill-accuracy": 50,
      "skill-movePool": 3,
      "skill-allowLosing": true,
    },
  },
  {
    username: "Helios-Sharp",
    strength: 85,
    engineBuild: ENGINE_BUILD,
    description:
      "Slips now and then, but never into a losing move. You will need a real idea.",
    options: {
      ...COMMON,
      maxNodes: 100_000,
      "skill-accuracy": 80,
      "skill-movePool": 3,
      "skill-allowLosing": false,
    },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description: "No handicap at all. Expect a long wait, and a hard game.",
    options: { ...COMMON, maxNodes: 200_000, "skill-accuracy": 100 },
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
