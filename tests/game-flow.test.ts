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
  renameUser,
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
  timingStats,
  createSession,
  userForSession,
  GameError,
  decodeBoard,
} = await import("../lib/db/queries.ts");

const { getDb } = await import("../lib/db/index.ts");
const { P1_GOAL, P2_GOAL, replay, startingBoard } = await import(
  "../lib/game/board.ts"
);

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

// --- renaming --------------------------------------------------------------

test("renaming keeps every past game", () => {
  const a = createUser(uniqueName("oldname"));
  const b = createUser(uniqueName("opponent"));
  const g = createGame(a.id, 3600);
  joinGame(g.id, b.id);
  submitMove(g.id, a.id, [0, 6]);

  const newName = uniqueName("newname");
  const renamed = renameUser(a.id, newName);
  assert.equal(renamed.username, newName);
  assert.equal(renamed.id, a.id, "the id never changes");

  // The game still belongs to them, and now shows the new name.
  const game = getGame(g.id)!;
  assert.equal(game.player1_id, a.id);
  assert.equal(game.player1_name, newName);
  assert.ok(listGamesForUser(a.id).some((x) => x.id === g.id));

  // And their moves are untouched.
  assert.equal(getMoves(g.id).length, 1);
});

test("renaming frees the old name and keeps the new one unique", () => {
  const first = uniqueName("freed");
  const a = createUser(first);
  renameUser(a.id, uniqueName("moved"));

  // The old name is available again.
  const b = createUser(first);
  assert.notEqual(b.id, a.id);

  // And it cannot be taken back while someone else holds it.
  assert.throws(() => renameUser(a.id, first), /taken/i);
});

test("renaming validates like signing up", () => {
  const a = createUser(uniqueName("valid"));
  assert.throws(() => renameUser(a.id, "x"), /between/i);
  assert.throws(() => renameUser(a.id, "has spaces"), /only/i);
});

test("changing only the case of your own name is allowed", () => {
  const name = uniqueName("Casechange");
  const a = createUser(name.toLowerCase());
  const renamed = renameUser(a.id, name.toUpperCase());
  assert.equal(renamed.username, name.toUpperCase());
});

test("a session survives a rename", () => {
  const a = createUser(uniqueName("sessionkeep"));
  const token = createSession(a.id);
  const newName = uniqueName("renamed");
  renameUser(a.id, newName);

  const stillMe = userForSession(token);
  assert.ok(stillMe, "the session is still valid");
  assert.equal(stillMe!.id, a.id);
  assert.equal(stillMe!.username, newName, "and reflects the new name");
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

// --- the starting position --------------------------------------------------

test("a game records the position it started from", () => {
  const { gameId } = twoPlayerGame();
  const g = getGame(gameId)!;
  assert.equal(g.start_board.length, 38);
  assert.equal(g.start_board, g.board, "before any move, start equals current");
});

test("the starting position survives every move", () => {
  const { a, b, gameId } = twoPlayerGame();
  const start = getGame(gameId)!.start_board;

  submitMove(gameId, a.id, [0, 6]);
  submitMove(gameId, b.id, [35, 29]);

  const g = getGame(gameId)!;
  assert.equal(g.start_board, start, "the start position never changes");
  assert.notEqual(g.board, start, "but the current position has moved on");
});

test("replaying the moves from the stored start reaches the current position", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]);
  submitMove(gameId, b.id, [35, 29]);
  submitMove(gameId, a.id, [1, 7]);

  const g = getGame(gameId)!;
  const replayed = replay(
    getMoves(gameId).map((m) => m.move.split("|").map(Number)),
    decodeBoard(g.start_board),
  );
  assert.equal(
    replayed.join(""),
    g.board,
    "the move list plus the stored start must reproduce the cached position",
  );
});

test("a game can start from a non-standard position", () => {
  // The point of storing the start: a game that did not begin from the
  // standard setup still replays correctly.
  const a = createUser(uniqueName("custom"));
  const b = createUser(uniqueName("custom"));
  const custom = startingBoard();
  custom[0] = 0;
  custom[12] = 3;

  const g = createGame(a.id, 3600, custom);
  joinGame(g.id, b.id);

  const stored = getGame(g.id)!;
  assert.equal(stored.start_board, custom.join(""));
  assert.equal(stored.board, custom.join(""));
});

// --- timing and stats ------------------------------------------------------

test("a game records when it started and when it ended", () => {
  const a = createUser(uniqueName("timing"));
  const b = createUser(uniqueName("timing"));
  const g = createGame(a.id, 3600);

  assert.equal(g.started_at, null, "an open game has not started");
  assert.equal(g.finished_at, null);

  joinGame(g.id, b.id);
  const joined = getGame(g.id)!;
  assert.ok(joined.started_at, "joining starts the game");
  assert.equal(joined.finished_at, null);

  const done = submitMove(g.id, a.id, [30, P2_GOAL]);
  assert.ok(done.finished_at, "finishing records the end time");
  assert.ok(done.finished_at! >= joined.started_at!);
});

test("started_at is distinct from created_at", () => {
  // A game can sit open for days. Without a separate started_at, the first
  // move would appear to have taken as long as the wait for an opponent.
  const a = createUser(uniqueName("waited"));
  const b = createUser(uniqueName("waited"));
  const g = createGame(a.id, 3600);

  // Pretend the game was created a week ago.
  const weekAgo = Math.floor(Date.now() / 1000) - 604800;
  getDb().prepare("UPDATE games SET created_at = ? WHERE id = ?").run(weekAgo, g.id);

  joinGame(g.id, b.id);
  submitMove(g.id, a.id, [0, 6]);

  const [first] = getMoves(g.id);
  assert.ok(
    first.think_ms !== null && first.think_ms < 60_000,
    `first move should be measured from the start, not creation (got ${first.think_ms}ms)`,
  );
});

test("each move records how long the player took", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]);
  submitMove(gameId, b.id, [35, 29]);

  const moves = getMoves(gameId);
  for (const m of moves) {
    assert.ok(m.think_ms !== null, `ply ${m.ply} has no think time`);
    assert.ok(m.think_ms! >= 0);
    // Move timestamps are milliseconds, so they are far larger than a
    // seconds-based epoch would be.
    assert.ok(m.created_at > 1_000_000_000_000, "timestamps should be ms");
  }
});

test("timing statistics are derivable from stored moves", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 6]);
  submitMove(gameId, b.id, [35, 29]);
  submitMove(gameId, a.id, [1, 7]);

  const stats = timingStats(a.id);
  assert.equal(stats.moves, 2, "counts only this player's moves");
  assert.ok(stats.medianThinkMs !== null);
  assert.ok(stats.fastestMs !== null && stats.slowestMs !== null);
  assert.ok(stats.fastestMs! <= stats.slowestMs!);
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
