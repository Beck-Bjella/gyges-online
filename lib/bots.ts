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
 * **Every one thinks exactly as hard.** Scaling `maxNodes` up the ladder was
 * tried and dropped: search depth is not the lever it looks like, because even
 * a shallow search is far past a human, so the rungs mostly differed in how
 * long the player waited. Holding the budget at 50,000 — about two seconds on a
 * desktop — makes the ladder a ladder of *judgement*, and makes the wait the
 * same whichever opponent is chosen.
 *
 * So the only thing that changes between these five is `skill-accuracy`: the
 * percentage of turns the engine plays the best move it found. The other two
 * settings are deliberately held constant, because a rung that moved three
 * dials at once would tell you nothing about which one you were feeling.
 *
 * - **`skill-movePool: 4`** — how many alternatives it chooses among on the
 *   turns it does not play the best move. Counted *below* the best move, so
 *   accuracy alone decides whether the best move gets played.
 * - **`skill-allowLosing: true`** — those alternatives include moves that lose
 *   outright. This is what makes a bot beatable by a threat it can see. Without
 *   it a bot errs constantly and still never hangs a game, because every
 *   alternative is another sound reply.
 *
 * Helios-Full sets neither, taking the engine defaults. `skill-allowLosing`
 * turns off two prunes in the search, which changes how the node budget is
 * spent even when the engine never slips — measured as the same move with a
 * different evaluation in about one position in six. A bot billed as having no
 * handicap should have exactly none.
 *
 * A phone is two to four times slower than the two seconds above. Because the
 * budget is work rather than time, only the waiting changes, never the move.
 */
const NODES = 50_000;

/** Settings shared by every handicapped bot, so only accuracy varies. */
const HANDICAP = {
  maxNodes: NODES,
  "skill-movePool": 4,
  "skill-allowLosing": true,
};

export const BOTS: BotSpec[] = [
  {
    username: "Helios-Novice",
    strength: 20,
    engineBuild: ENGINE_BUILD,
    description:
      "Never plays the best move it found. Walks into threats. Where to start.",
    options: { ...COMMON, ...HANDICAP, "skill-accuracy": 0 },
  },
  {
    username: "Helios-Casual",
    strength: 40,
    engineBuild: ENGINE_BUILD,
    description: "Finds the right move about a quarter of the time. Very punishable.",
    options: { ...COMMON, ...HANDICAP, "skill-accuracy": 25 },
  },
  {
    username: "Helios-Club",
    strength: 60,
    engineBuild: ENGINE_BUILD,
    description: "Right half the time, and can still lose a game outright.",
    options: { ...COMMON, ...HANDICAP, "skill-accuracy": 50 },
  },
  {
    username: "Helios-Sharp",
    strength: 80,
    engineBuild: ENGINE_BUILD,
    description: "Slips about one turn in four. You will need a real idea.",
    options: { ...COMMON, ...HANDICAP, "skill-accuracy": 75 },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description: "No handicap at all. Always its best move.",
    options: { ...COMMON, maxNodes: NODES, "skill-accuracy": 100 },
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
