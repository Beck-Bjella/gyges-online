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
 * **Depth is capped, not nodes, and only 1 and 3 are usable.**
 *
 * A node budget cannot bound depth: the same 20,000 nodes reaches about three
 * ply in a crowded opening and thirteen in a sparse endgame, so a node-bounded
 * bot gets *stronger as the game simplifies* — exactly when a player is trying
 * to convert. That is what made the 50,000-node ladder unbeatable in endgames.
 *
 * Iterative deepening runs odd plies only (1, 3, 5, 7), so `maxPly: 2` behaves
 * identically to 1. Of what remains, 1 is pinnable, 3 already forces you to
 * plan, and 5 is both near-impossible and slow in some positions. One usable
 * step.
 *
 * So depth is not the ladder — it picks the class, and the ladder lives inside
 * it. Three rungs at one ply, where a game is winnable, and two at three ply.
 *
 * Bounding by depth was avoided earlier because a low ply can take unpredictable
 * time in a tactical position. Measured across a real game at ply 3: median
 * 0.17s a move, worst case 2.4s. That concern is real further up and does not
 * bite here.
 *
 * - **`skill-weakness`** — how much of the gap between a move and the best one
 *   is forgiven, 0-100. At 0 it always plays the best move; at 100 everything
 *   it considers is level and the choice is near random. Stockfish's rule, and
 *   smoother than choosing a rank: a slightly worse move is easy to land on, a
 *   much worse one is not, and because it reads the *scores* rather than the
 *   ordering, one setting wanders freely in a quiet position and stays honest
 *   in a sharp one.
 *
 * - **`skill-reach`** — how far down the ranked list the handicap is measured
 *   against, as a percent. This sets the unit weakness is denominated in: a
 *   move can beat the best one only when its deficit is under
 *   `gap-to-the-reach-th-move x w/(100-w)`.
 *
 *   It has to move with weakness, not be left at a default. Stockfish takes
 *   this span across the top four because MultiPV fixes its pool at four; taken
 *   across a wider pool while still measured over the top four, the reach stays
 *   pinned to how much the leading moves happen to differ, and the engine plays
 *   its best move whatever weakness says. That is why the ply-1 bots stayed
 *   strong against good play.
 *
 * - **`skill-allowLosing`** — whether moves the search sees as a forced loss
 *   stay choosable. Losing moves sort to the *bottom* of the list, so this and
 *   the window together are a gradient rather than a switch: with it on, a low
 *   window rarely reaches a losing move and a high one lands on them often.
 *
 * Turning it off entirely was tried and made the bottom of the ladder *harder*.
 * A bot that never throws a game answers every threat inside its horizon, so
 * beating it means genuinely breaking through — which is not what the easiest
 * opponent should ask of anyone. The bottom three keep it on; Sharp and Full do
 * not, which is what separates "makes real mistakes" from "only misses deep
 * ideas".
 *
 * A phone is two to four times slower. Because the bound is depth rather than
 * seconds, only the waiting changes, never the move.
 */


export const BOTS: BotSpec[] = [
  {
    username: "Helios-Novice",
    strength: 20,
    engineBuild: ENGINE_BUILD,
    description:
      "Never plays the best move it found, and usually one of its worst. Where to start.",
    options: {
      ...COMMON,
      maxPly: 1,
      "skill-weakness": 85,
      "skill-reach": 60,
      "skill-allowLosing": true,
    },
  },
  {
    username: "Helios-Casual",
    strength: 40,
    engineBuild: ENGINE_BUILD,
    description: "Finds the right move about a fifth of the time. Very punishable.",
    options: {
      ...COMMON,
      maxPly: 1,
      "skill-weakness": 70,
      "skill-reach": 35,
      "skill-allowLosing": true,
    },
  },
  {
    username: "Helios-Club",
    strength: 60,
    engineBuild: ENGINE_BUILD,
    description: "Right about half the time, and the rest are visibly worse.",
    options: {
      ...COMMON,
      maxPly: 1,
      "skill-weakness": 50,
      "skill-reach": 20,
    },
  },
  {
    username: "Helios-Sharp",
    strength: 80,
    engineBuild: ENGINE_BUILD,
    description: "Slips about one turn in three, but only slightly. You will need a real idea.",
    options: {
      ...COMMON,
      maxPly: 3,
      "skill-weakness": 30,
      "skill-reach": 10,
    },
  },
  {
    username: "Helios-Full",
    strength: 100,
    engineBuild: ENGINE_BUILD,
    description: "No handicap at all. Always its best move.",
    options: { ...COMMON, maxPly: 3 },
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
