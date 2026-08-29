/**
 * Talking to the Gygès engine.
 *
 * Pure functions, like the rest of lib/game/: no I/O, no framework. The engine
 * itself runs in the player's browser (public/engine/engine-worker.js); this
 * module is the translation between how the site stores a position and how the
 * engine expects to be handed one.
 *
 * ## The engine always plays as player 1
 *
 * `Searcher::go` generates its root moves for `Player::One` unconditionally, so
 * the engine has no notion of "search for the other side". A position where
 * player 2 is to move must therefore be handed over **flipped**, and the move it
 * returns flipped back.
 *
 * Keeping that here rather than in the worker means the orientation is decided
 * on the server, where it is covered by tests, rather than in a browser that a
 * player can edit. It also means the worker stays a dumb pipe: a board string
 * goes in, a move string comes out.
 */

import {
  flipBoard,
  flipMove,
  moveFromString,
  moveToString,
  type BoardState,
  type Move,
  type Player,
} from "./board.ts";

/**
 * Orient a position so the side to move is the one the engine searches for.
 *
 * Player 1 is handed the board unchanged; player 2 gets it flipped, which puts
 * their home row where the engine expects its own.
 */
export function boardForEngine(board: BoardState, player: Player): BoardState {
  return player === 1 ? board : flipBoard(board);
}

/**
 * Translate a move the engine produced back into site orientation.
 *
 * The inverse of boardForEngine: a move found in a flipped position has to be
 * flipped back before it means anything in the stored game. flipMove is its own
 * inverse, so this is symmetric.
 *
 * Returns null for a move string the engine could not produce a move for — it
 * emits `bestmove null` for a position it judges drawn.
 */
export function moveFromEngine(encoded: string | null, player: Player): Move | null {
  if (!encoded || encoded === "null") return null;
  const move = moveFromString(encoded);
  return player === 1 ? move : flipMove(move);
}

/** The wire form the engine expects a position in: 38 digits. */
export function boardToEngineString(board: BoardState): string {
  return board.join("");
}

/**
 * The arrangement a bot places during setup.
 *
 * The engine cannot help here: it asserts a full twelve pieces before it will
 * search, and a home row being arranged has at most six. So the bot uses the
 * conventional order, which is a perfectly ordinary opening and keeps setup
 * deterministic like the rest of its play.
 *
 * Varying this per bot would be a real improvement — the arrangement is a
 * genuine decision, and always playing the same one makes a bot predictable
 * from move zero. It needs a way to judge arrangements, which the engine does
 * not currently offer.
 */
export const BOT_SETUP: readonly number[] = [3, 2, 1, 1, 2, 3];

/** Round-trip helper used by tests: encode a move the way the engine would. */
export function moveToEngineString(move: Move, player: Player): string {
  return moveToString(player === 1 ? move : flipMove(move));
}
