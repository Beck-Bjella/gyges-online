/**
 * Tests for the server-side game rules of engagement.
 *
 * These use a throwaway database file and exercise the query layer directly —
 * who may act, when, and what the record ends up saying. They are about
 * authority and bookkeeping, NOT about the rules of Gygès.
 *
 * Run with: npm test
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The database module reads this at first connection, so it must be set before
// the module is imported.
const dir = mkdtempSync(join(tmpdir(), "gyges-test-"));
process.env.GYGES_DB_PATH = join(dir, "test.db");

const {
  createUser,
  createGame,
  joinGame,
  submitMove,
  resignGame,
  getGame,
  getMoves,
  listOpenGames,
  listGamesForUser,
  settleExpiredGames,
  sideOf,
  leaderboard,
  GameError,
  decodeBoard,
} = await import("../lib/db/queries.ts");

const { getDb } = await import("../lib/db/index.ts");
const { P1_GOAL, P2_GOAL } = await import("../lib/game/board.ts");

after(() => {
  try {
    getDb().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function uniqueName(prefix: string): string {
  return `${prefix}${n++}`;
}

function twoPlayerGame(moveSeconds = 3600) {
  const a = createUser(uniqueName("alice"));
  const b = createUser(uniqueName("bob"));
  const g = createGame(a.id, moveSeconds);
  joinGame(g.id, b.id);
  return { a, b, gameId: g.id };
}

// --- users -----------------------------------------------------------------

test("usernames are unique regardless of case", () => {
  const name = uniqueName("Case");
  createUser(name);
  assert.throws(() => createUser(name.toUpperCase()), /taken/i);
});

test("usernames are validated", () => {
  assert.throws(() => createUser("x"), /between/i);
  assert.throws(() => createUser("has spaces"), /only/i);
  assert.throws(() => createUser("a".repeat(25)), /between/i);
});

// --- joining ---------------------------------------------------------------

test("a new game is open and waiting", () => {
  const a = createUser(uniqueName("solo"));
  const g = createGame(a.id);
  assert.equal(g.status, "open");
  assert.equal(g.ply, 0);
  assert.equal(g.deadline_at, null);
  assert.ok(listOpenGames().some((x) => x.id === g.id));
});

test("joining activates the game and sets a deadline", () => {
  const { gameId } = twoPlayerGame();
  const g = getGame(gameId)!;
  assert.equal(g.status, "active");
  assert.ok(g.deadline_at! > Math.floor(Date.now() / 1000));
  // It is no longer offered to other players.
  assert.equal(listOpenGames().some((x) => x.id === gameId), false);
});

test("a game cannot be joined twice", () => {
  const { gameId } = twoPlayerGame();
  const c = createUser(uniqueName("carol"));
  assert.throws(() => joinGame(gameId, c.id), GameError);
});

test("the creator cannot join their own game", () => {
  const a = createUser(uniqueName("selfjoin"));
  const g = createGame(a.id);
  assert.throws(() => joinGame(g.id, a.id), /your own/i);
});

// --- turn order ------------------------------------------------------------

test("only a participant may move", () => {
  const { gameId } = twoPlayerGame();
  const stranger = createUser(uniqueName("stranger"));
  assert.throws(() => submitMove(gameId, stranger.id, [0, 6]), /not a player/i);
});

test("players must alternate", () => {
  const { a, b, gameId } = twoPlayerGame();
  assert.throws(() => submitMove(gameId, b.id, [35, 29]), /not your turn/i);
  submitMove(gameId, a.id, [0, 6]);
  assert.throws(() => submitMove(gameId, a.id, [1, 7]), /not your turn/i);
  submitMove(gameId, b.id, [35, 29]);
});

test("each move appends to the record and advances the ply", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]);
  submitMove(gameId, b.id, [35, 29]);

  const g = getGame(gameId)!;
  assert.equal(g.ply, 2);
  assert.equal(g.turn, 1);

  const moves = getMoves(gameId);
  assert.equal(moves.length, 2);
  assert.deepEqual(
    moves.map((m) => m.ply),
    [1, 2],
  );
  assert.deepEqual(
    moves.map((m) => m.player),
    [1, -1],
  );
  assert.equal(moves[0].move, "0|6");
  // The cached position matches the last move's result.
  assert.equal(g.board, moves[1].board_after);
});

test("structurally invalid moves are rejected", () => {
  const { a, gameId } = twoPlayerGame();
  assert.throws(() => submitMove(gameId, a.id, [20, 21]), /no piece/i);
  assert.throws(() => submitMove(gameId, a.id, [0, 1]), /occupied/i);
  assert.throws(() => submitMove(gameId, a.id, [0]), /2 or 3/i);
  // None of the rejections left a trace.
  assert.equal(getGame(gameId)!.ply, 0);
  assert.equal(getMoves(gameId).length, 0);
});

// --- endings ---------------------------------------------------------------

test("reaching the opponent's goal wins", () => {
  const { a, gameId } = twoPlayerGame();
  // Player 1 reaches P2's goal. Legality is not checked, so this is allowed.
  const g = submitMove(gameId, a.id, [30, P2_GOAL]);
  assert.equal(g.status, "finished");
  assert.equal(g.result, 1);
  assert.equal(g.result_reason, "goal");
  assert.equal(g.deadline_at, null);
  assert.notEqual(decodeBoard(g.board)[P2_GOAL], 0);
});

test("reaching your own goal credits the opponent", () => {
  const { a, gameId } = twoPlayerGame();
  const g = submitMove(gameId, a.id, [0, P1_GOAL]);
  assert.equal(g.result, -1, "a piece on P1_GOAL means player 2 got there");
});

test("no moves are accepted after a game ends", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [30, P2_GOAL]);
  assert.throws(() => submitMove(gameId, b.id, [35, 29]), /not in progress/i);
});

test("resigning awards the opponent the win", () => {
  const { a, gameId } = twoPlayerGame();
  const g = resignGame(gameId, a.id);
  assert.equal(g.status, "finished");
  assert.equal(g.result, -1);
  assert.equal(g.result_reason, "resign");
});

test("a non-participant cannot resign", () => {
  const { gameId } = twoPlayerGame();
  const stranger = createUser(uniqueName("nosy"));
  assert.throws(() => resignGame(gameId, stranger.id), /not a player/i);
});

// --- deadlines -------------------------------------------------------------

test("a game past its deadline is forfeited by the player to move", () => {
  const { a, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]); // now player 2 is to move

  // Reach past the deadline without waiting.
  getDb()
    .prepare("UPDATE games SET deadline_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000) - 1, gameId);

  const settled = settleExpiredGames();
  assert.ok(settled >= 1);

  const g = getGame(gameId)!;
  assert.equal(g.status, "finished");
  assert.equal(g.result_reason, "timeout");
  assert.equal(g.result, 1, "player 2 ran out of time, so player 1 wins");
});

test("settling leaves games inside their deadline alone", () => {
  const { gameId } = twoPlayerGame();
  settleExpiredGames();
  assert.equal(getGame(gameId)!.status, "active");
});

// --- concurrency -----------------------------------------------------------

test("the same ply cannot be written twice", () => {
  const { a, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]);

  // Simulate a duplicate arriving for a ply that already exists. The primary
  // key on (game_id, ply) is the backstop if the turn check is ever bypassed.
  assert.throws(() =>
    getDb()
      .prepare(
        `INSERT INTO moves (game_id, ply, player, move, board_after, created_at)
         VALUES (?, 1, 1, '0|7', ?, 0)`,
      )
      .run(gameId, "0".repeat(38)),
  );

  assert.equal(getMoves(gameId).length, 1);
});

test("a second move at the same turn is refused", () => {
  const { a, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]);
  // Whatever else player 1 tries, the turn has already passed to player 2.
  assert.throws(() => submitMove(gameId, a.id, [1, 7]), /not your turn/i);
  assert.throws(() => submitMove(gameId, a.id, [2, 8]), /not your turn/i);
  assert.equal(getGame(gameId)!.ply, 1);
});

// --- listing and leaderboard ----------------------------------------------

test("sideOf identifies the players", () => {
  const { a, b, gameId } = twoPlayerGame();
  const g = getGame(gameId)!;
  assert.equal(sideOf(g, a.id), 1);
  assert.equal(sideOf(g, b.id), -1);
  assert.equal(sideOf(g, "nobody"), null);
  assert.equal(sideOf(g, null), null);
});

test("a player's games are listed for them", () => {
  const { a, gameId } = twoPlayerGame();
  assert.ok(listGamesForUser(a.id).some((g) => g.id === gameId));
  const other = createUser(uniqueName("elsewhere"));
  assert.equal(listGamesForUser(other.id).some((g) => g.id === gameId), false);
});

test("the leaderboard counts finished games", () => {
  const winnerName = uniqueName("champion");
  const w = createUser(winnerName);
  const l = createUser(uniqueName("challenger"));

  for (let i = 0; i < 2; i++) {
    const g = createGame(w.id);
    joinGame(g.id, l.id);
    submitMove(g.id, w.id, [30, P2_GOAL]);
  }

  const row = leaderboard(100).find((r) => r.username === winnerName);
  assert.ok(row, "the winner appears on the leaderboard");
  assert.equal(row!.wins, 2);
  assert.equal(row!.losses, 0);
  assert.equal(row!.played, 2);
});

before(() => {
  // Touch the database so the schema is created before the first test.
  getDb();
});
