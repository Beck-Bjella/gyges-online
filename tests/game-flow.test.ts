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
  submitSetup,
  submitMove,
  undoTurn,
  createChallenge,
  friendState,
  sendFriendRequest,
  respondToFriendRequest,
  listFriends,
  resignGame,
  getGame,
  getMoves,
  listOpenGames,
  listActiveGames,
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
const { P1_GOAL, P2_GOAL, replay, startingBoard, SETUP_PIECES, emptyBoard } =
  await import("../lib/game/board.ts");

const STANDARD = [...SETUP_PIECES];

/**
 * A legal opening move for player 1 from the standard arrangement.
 *
 * The three-ring piece on square 0 travels exactly three squares: 0 -> 6 -> 12
 * -> 13. Used throughout as "any legal move", so these tests stay about
 * bookkeeping rather than about the rules.
 */
const P1_OPENING: number[] = [0, 13];

/** A legal reply for player 2 after P1_OPENING: 30 -> 24 -> 18 -> 12. */
const P2_REPLY: number[] = [30, 12];

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

/**
 * A game that has finished setup and is ready for ordinary play.
 *
 * The first move is handed to player 1, overriding the coin toss the real
 * game makes. Every test below that is not *about* the toss wants a fixed
 * starting side, and a random one would make them fail one run in two. The
 * toss itself is covered by its own test.
 */
function twoPlayerGame(moveSeconds = 3600) {
  const { a, b, gameId } = gameInSetup(moveSeconds);
  submitSetup(gameId, a.id, STANDARD);
  submitSetup(gameId, b.id, STANDARD);
  getDb().prepare("UPDATE games SET turn = 1 WHERE id = ?").run(gameId);
  return { a, b, gameId };
}

/** A game with both players present, waiting for player 1 to place. */
function gameInSetup(moveSeconds = 3600) {
  const a = createUser(uniqueName("alice"));
  const b = createUser(uniqueName("bob"));
  const g = createGame(a.id, moveSeconds);
  joinGame(g.id, b.id);
  return { a, b, gameId: g.id };
}

/**
 * A game already in play, from a chosen position.
 *
 * Moves are now checked against the rules, so a test that wants a specific
 * outcome — a win, a game already over — has to reach it with a *legal* move.
 * This builds a game from an arbitrary board and pushes it past setup so that
 * such a move is available.
 *
 * The two setup plies are written directly rather than through submitSetup,
 * because the point is to start from a position of the test's choosing rather
 * than from two home rows.
 */
function gameFromPosition(board: number[], moveSeconds = 3600) {
  const a = createUser(uniqueName("alice"));
  const b = createUser(uniqueName("bob"));
  const g = createGame(a.id, moveSeconds, board);
  joinGame(g.id, b.id);

  const encoded = board.join("");
  const db = getDb();
  // Skip setup: mark both placements done and the game active.
  db.prepare(
    `UPDATE games SET status = 'active', ply = 2, turn = 1, board = ?
      WHERE id = ?`,
  ).run(encoded, g.id);
  for (const ply of [1, 2]) {
    db.prepare(
      `INSERT INTO moves (game_id, ply, player, kind, move, board_after, created_at)
       VALUES (?, ?, ?, 'setup', '321123', ?, ?)`,
    ).run(g.id, ply, ply === 1 ? 1 : -1, encoded, Date.now());
  }

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
  submitSetup(g.id, a.id, STANDARD);
  submitSetup(g.id, b.id, STANDARD);
  // About renaming, not turn order: pin the side the coin toss would pick.
  getDb().prepare("UPDATE games SET turn = 1 WHERE id = ?").run(g.id);
  submitMove(g.id, a.id, P1_OPENING);

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
  assert.equal(getMoves(g.id).length, 3, "two setups and a move");
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
  // It is no longer waiting for a player, so it leaves the open list.
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

// --- setup -----------------------------------------------------------------

test("a game starts from an empty board", () => {
  const a = createUser(uniqueName("empty"));
  const g = createGame(a.id, 3600);
  assert.equal(g.board, emptyBoard().join(""), "no pieces before setup");
  assert.equal(g.start_board, emptyBoard().join(""));
});

test("joining begins the setup phase, not play", () => {
  const { gameId } = gameInSetup();
  const g = getGame(gameId)!;
  assert.equal(g.status, "setup");
  assert.equal(g.turn, 1, "player 1 places first");
});

test("no moves are accepted during setup", () => {
  const { a, gameId } = gameInSetup();
  assert.throws(() => submitMove(gameId, a.id, P1_OPENING), /place their pieces/i);
});

test("players place in turn, then play begins", () => {
  const { a, b, gameId } = gameInSetup();

  assert.throws(() => submitSetup(gameId, b.id, STANDARD), /not your turn/i);

  const afterP1 = submitSetup(gameId, a.id, STANDARD);
  assert.equal(afterP1.status, "setup", "still setup after one placement");
  assert.equal(afterP1.turn, -1, "now player 2 places");
  assert.equal(decodeBoard(afterP1.board).filter((v) => v !== 0).length, 6);

  const afterP2 = submitSetup(gameId, b.id, STANDARD);
  assert.equal(afterP2.status, "active", "both placed, play begins");
  assert.ok(
    afterP2.turn === 1 || afterP2.turn === -1,
    "one side or the other moves first",
  );
  assert.equal(decodeBoard(afterP2.board).filter((v) => v !== 0).length, 12);
});

test("a placement must use each of the six pieces exactly once", () => {
  const { a, gameId } = gameInSetup();
  assert.throws(() => submitSetup(gameId, a.id, [3, 3, 3, 3, 3, 3]), /exactly once/i);
  assert.throws(() => submitSetup(gameId, a.id, [3, 2, 1]), /exactly once/i);
  assert.throws(() => submitSetup(gameId, a.id, [3, 2, 1, 1, 2, 0]), /exactly once/i);
});

test("a player may choose a non-standard arrangement", () => {
  const { a, b, gameId } = gameInSetup();
  const custom = [1, 1, 2, 2, 3, 3];
  submitSetup(gameId, a.id, custom);
  submitSetup(gameId, b.id, STANDARD);

  const board = decodeBoard(getGame(gameId)!.board);
  assert.deepEqual(board.slice(0, 6), custom, "player 1's row matches");
  assert.deepEqual(board.slice(30, 36), STANDARD, "player 2's row matches");
});

test("setup plies are recorded as history, marked as setup", () => {
  const { gameId } = twoPlayerGame();
  const moves = getMoves(gameId);
  assert.equal(moves.length, 2, "both placements are recorded");
  assert.equal(moves[0].kind, "setup");
  assert.equal(moves[1].kind, "setup");
  assert.equal(moves[0].move, STANDARD.join(""));
  assert.equal(moves[0].player, 1);
  assert.equal(moves[1].player, -1);
});

test("the whole game replays from the empty board", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, P1_OPENING);
  submitMove(gameId, b.id, P2_REPLY);

  const g = getGame(gameId)!;
  const rows = getMoves(gameId);

  // Setup plies place a row; move plies move a piece. Replaying both from the
  // stored (empty) start must reproduce the current position.
  let board = decodeBoard(g.start_board);
  for (const r of rows) {
    if (r.kind === "setup") {
      const arrangement = Array.from(r.move, Number);
      const row = r.player === 1 ? [0, 1, 2, 3, 4, 5] : [30, 31, 32, 33, 34, 35];
      const next = [...board];
      row.forEach((idx, i) => (next[idx] = arrangement[i]));
      board = next;
    } else {
      board = replay([r.move.split("|").map(Number)], board);
    }
  }
  assert.equal(board.join(""), g.board);
});

test("a placement cannot be submitted once play has begun", () => {
  const { a, gameId } = twoPlayerGame();
  assert.throws(() => submitSetup(gameId, a.id, STANDARD), /not being set up/i);
});

// --- turn order ------------------------------------------------------------

test("only a participant may move", () => {
  const { gameId } = twoPlayerGame();
  const stranger = createUser(uniqueName("stranger"));
  assert.throws(() => submitMove(gameId, stranger.id, P1_OPENING), /not a player/i);
});

test("players must alternate", () => {
  const { a, b, gameId } = twoPlayerGame();
  assert.throws(() => submitMove(gameId, b.id, P2_REPLY), /not your turn/i);
  submitMove(gameId, a.id, P1_OPENING);
  assert.throws(() => submitMove(gameId, a.id, [1, 7]), /not your turn/i);
  submitMove(gameId, b.id, P2_REPLY);
});

test("each move appends to the record and advances the ply", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, P1_OPENING);
  submitMove(gameId, b.id, P2_REPLY);

  const g = getGame(gameId)!;
  // Plies 1 and 2 are the two setups; play starts at ply 3.
  assert.equal(g.ply, 4);
  assert.equal(g.turn, 1);

  const moves = getMoves(gameId);
  assert.equal(moves.length, 4);
  assert.deepEqual(
    moves.map((m) => m.ply),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    moves.map((m) => m.kind),
    ["setup", "setup", "move", "move"],
  );
  assert.deepEqual(
    moves.map((m) => m.player),
    [1, -1, 1, -1],
  );
  assert.equal(moves[2].move, P1_OPENING.join("|"));
  // The cached position matches the last move's result.
  assert.equal(g.board, moves[3].board_after);
});

test("structurally invalid moves are rejected", () => {
  const { a, gameId } = twoPlayerGame();
  assert.throws(() => submitMove(gameId, a.id, [20, 21]), /no piece/i);
  assert.throws(() => submitMove(gameId, a.id, [0, 1]), /occupied/i);
  assert.throws(() => submitMove(gameId, a.id, [0]), /2 or 3/i);
  // None of the rejections left a trace beyond the two setup plies.
  assert.equal(getGame(gameId)!.ply, 2);
  assert.equal(getMoves(gameId).length, 2);
});

// --- endings ---------------------------------------------------------------

/**
 * A position where player 1 can legally bear off.
 *
 * A single one-ring piece on row 4 (index 24). It can step to row 5 and, from
 * the row beyond the opponent's home, into P2_GOAL. The lone piece at 35 gives
 * player 2 something to move so the game is not degenerate.
 */
function winnableByP1(): number[] {
  const b = emptyBoard();
  // A two-ring piece at 24 (row 4) steps 24 -> 30 (the far row) and out into
  // P2_GOAL. Bearing off requires the LAST step to leave the far row, so a
  // one-ring piece here could reach row 5 but not the goal.
  b[24] = 2;
  return b;
}

test("reaching the opponent's goal wins", () => {
  const { a, gameId } = gameFromPosition(winnableByP1());
  const g = submitMove(gameId, a.id, [24, P2_GOAL]);
  assert.equal(g.status, "finished");
  assert.equal(g.result, 1);
  assert.equal(g.result_reason, "goal");
  assert.equal(g.deadline_at, null);
  assert.notEqual(decodeBoard(g.board)[P2_GOAL], 0);
});

test("reaching your own goal credits the opponent", () => {
  // The goals are named for the board's geography, not for who scores in them:
  // P1_GOAL is the space beyond player 1's home row, so a piece arriving there
  // means PLAYER 2 has crossed the board. This is the case goalFor() exists to
  // stop people reasoning about by hand.
  //
  // Player 2 moves a piece on row 1 down into P1_GOAL and wins.
  const board = emptyBoard();
  // A one-ring piece at 6 is on row 1; player 2 steps it down to row 0 and out.
  board[6] = 2;
  const { b, gameId } = gameFromPosition(board);

  // It is player 2's turn to move in this position.
  getDb().prepare("UPDATE games SET turn = -1 WHERE id = ?").run(gameId);

  const g = submitMove(gameId, b.id, [6, P1_GOAL]);
  assert.equal(g.result, -1, "a piece on P1_GOAL means player 2 got there");
  assert.equal(g.result_reason, "goal");
});

test("no moves are accepted after a game ends", () => {
  const { a, b, gameId } = gameFromPosition(winnableByP1());
  submitMove(gameId, a.id, [24, P2_GOAL]);
  assert.throws(() => submitMove(gameId, b.id, P2_REPLY), /not in progress/i);
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
  submitMove(gameId, a.id, P1_OPENING); // now player 2 is to move

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
  const a = createUser(uniqueName("startrec"));
  const g = createGame(a.id, 3600);
  assert.equal(g.start_board.length, 38);
  assert.equal(g.start_board, g.board, "before any placement, start equals current");
  assert.equal(g.start_board, emptyBoard().join(""), "and the board is empty");
});

test("the starting position survives every move", () => {
  const { a, b, gameId } = twoPlayerGame();
  const start = getGame(gameId)!.start_board;
  assert.equal(start, emptyBoard().join(""));

  submitMove(gameId, a.id, P1_OPENING);
  submitMove(gameId, b.id, P2_REPLY);

  const g = getGame(gameId)!;
  assert.equal(g.start_board, start, "the start position never changes");
  assert.notEqual(g.board, start, "but the current position has moved on");
});

test("replaying the moves from the post-setup position reaches the current one", () => {
  const { a, b, gameId } = twoPlayerGame();
  const afterSetup = getMoves(gameId).find((m) => m.ply === 2)!.board_after;

  submitMove(gameId, a.id, P1_OPENING);
  submitMove(gameId, b.id, P2_REPLY);
  submitMove(gameId, a.id, [1, 7]);

  const g = getGame(gameId)!;
  const replayed = replay(
    getMoves(gameId)
      .filter((m) => m.kind === "move")
      .map((m) => m.move.split("|").map(Number)),
    decodeBoard(afterSetup),
  );
  assert.equal(replayed.join(""), g.board);
});

test("a game can be created from a non-empty position", () => {
  // Storing the start keeps puzzles and handicaps possible later.
  const a = createUser(uniqueName("custom"));
  const custom = startingBoard();
  custom[0] = 0;
  custom[12] = 3;

  const g = createGame(a.id, 3600, custom);
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

  submitSetup(g.id, a.id, STANDARD);
  submitSetup(g.id, b.id, STANDARD);
  // This test is about timestamps, not turn order, so pin the side the coin
  // toss would otherwise pick.
  getDb().prepare("UPDATE games SET turn = 1 WHERE id = ?").run(g.id);
  // 0 -> 6 -> 12 -> 13: the three-ring piece's first legal move.
  const done = submitMove(g.id, a.id, [0, 13]);
  assert.ok(done.updated_at >= joined.started_at!);

  const finished = resignGame(g.id, b.id);
  assert.ok(finished.finished_at, "finishing records the end time");
  assert.ok(finished.finished_at! >= joined.started_at!);
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
  submitSetup(g.id, a.id, STANDARD);

  const [first] = getMoves(g.id);
  assert.ok(
    first.think_ms !== null && first.think_ms < 60_000,
    `first move should be measured from the start, not creation (got ${first.think_ms}ms)`,
  );
});

test("each move records how long the player took", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, P1_OPENING);
  submitMove(gameId, b.id, P2_REPLY);

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
  submitMove(gameId, a.id, P1_OPENING);
  submitMove(gameId, b.id, P2_REPLY);
  submitMove(gameId, a.id, [1, 7]);

  const stats = timingStats(a.id);
  // Two moves plus one setup placement.
  assert.equal(stats.moves, 3, "counts only this player's actions");
  assert.ok(stats.medianThinkMs !== null);
  assert.ok(stats.fastestMs !== null && stats.slowestMs !== null);
  assert.ok(stats.fastestMs! <= stats.slowestMs!);
});

// --- concurrency -----------------------------------------------------------

test("the same ply cannot be written twice", () => {
  const { a, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, P1_OPENING);

  // Simulate a duplicate arriving for a ply that already exists. The primary
  // key on (game_id, ply) is the backstop if the turn check is ever bypassed.
  assert.throws(() =>
    getDb()
      .prepare(
        `INSERT INTO moves (game_id, ply, player, kind, move, board_after, created_at)
         VALUES (?, 3, 1, 'move', '0|7', ?, 0)`,
      )
      .run(gameId, "0".repeat(38)),
  );

  assert.equal(getMoves(gameId).length, 3, "two setups and one move");
});

test("a second move at the same turn is refused", () => {
  const { a, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, P1_OPENING);
  // Whatever else player 1 tries, the turn has already passed to player 2.
  assert.throws(() => submitMove(gameId, a.id, [1, 7]), /not your turn/i);
  assert.throws(() => submitMove(gameId, a.id, [2, 8]), /not your turn/i);
  assert.equal(getGame(gameId)!.ply, 3, "two setups plus the one move");
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

test("the public lists show everyone's games, including your own", () => {
  // These lists must mean the same thing to every viewer. Hiding the viewer's
  // own games made a game vanish from "in progress" for the people playing it,
  // which is exactly who would look for it.
  const { a, b, gameId } = twoPlayerGame();

  const active = listActiveGames();
  assert.ok(
    active.some((g) => g.id === gameId),
    "an active game appears in the public list",
  );

  // And it looks the same to a participant as to a stranger: the query takes
  // no viewer at all.
  const again = listActiveGames();
  assert.deepEqual(
    again.map((g) => g.id),
    active.map((g) => g.id),
  );
  void a;
  void b;
});

test("an open game is listed for its host as well as everyone else", () => {
  const host = createUser(uniqueName("host"));
  const g = createGame(host.id, 3600);

  assert.ok(
    listOpenGames().some((x) => x.id === g.id),
    "the host can see their own game waiting",
  );

  // Joining it is still refused; visibility and permission are separate.
  assert.throws(() => joinGame(g.id, host.id), /your own/i);
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
    submitSetup(g.id, w.id, STANDARD);
    submitSetup(g.id, l.id, STANDARD);
    // The loser resigns: a win for w, without needing a contrived position.
    resignGame(g.id, l.id);
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

test("the first move goes to a random side", () => {
  // Moving first is a real advantage, so it must not always fall to whoever
  // created the game. Twenty games: the odds of one side taking all of them by
  // chance are under one in five hundred thousand.
  const starters = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const { a, b, gameId } = gameInSetup();
    submitSetup(gameId, a.id, STANDARD);
    starters.add(submitSetup(gameId, b.id, STANDARD).turn);
  }
  assert.deepEqual([...starters].sort(), [-1, 1], "both sides should start some games");
});

test("the player to move can give the last move back", () => {
  const { a, b, gameId } = twoPlayerGame();
  submitMove(gameId, a.id, [0, 13]);

  // Only b, whose turn it is, may return a's move — and a cannot grab it back.
  assert.throws(() => undoTurn(gameId, a.id), /player to move/i);

  const before = getGame(gameId)!;
  const undone = undoTurn(gameId, b.id);
  assert.equal(undone.ply, before.ply - 1, "one ply removed");
  assert.equal(undone.turn, 1, "the move returns to the player who made it");
  const remaining = getMoves(gameId);
  assert.equal(remaining.length, 2, "only the setups remain");
  assert.equal(
    undone.board,
    remaining[1].board_after,
    "the board returns to the position after both setups",
  );

  // Nothing left to take back: the remaining plies are setup.
  assert.throws(() => undoTurn(gameId, a.id), /nothing to take back/i);
});

test("a challenge is an open game only the invited player can join", () => {
  const a = createUser(uniqueName("chal-a"));
  const b = createUser(uniqueName("chal-b"));
  const c = createUser(uniqueName("chal-c"));
  const g = createChallenge(a.id, b.id);

  assert.ok(
    !listOpenGames().some((x) => x.id === g.id),
    "reserved games stay out of the public lobby",
  );
  assert.throws(() => joinGame(g.id, c.id), /reserved/i);
  const joined = joinGame(g.id, b.id);
  assert.equal(joined.status, "setup");
});

test("friendship: ask, answer, and asking back accepts", () => {
  const a = createUser(uniqueName("fr-a"));
  const b = createUser(uniqueName("fr-b"));
  const c = createUser(uniqueName("fr-c"));

  assert.equal(friendState(a.id, b.id), "none");
  sendFriendRequest(a.id, b.id);
  assert.equal(friendState(a.id, b.id), "sent");
  assert.equal(friendState(b.id, a.id), "received");

  // Declining removes the request entirely, so asking again works.
  respondToFriendRequest(b.id, a.id, false);
  assert.equal(friendState(a.id, b.id), "none");

  sendFriendRequest(a.id, b.id);
  respondToFriendRequest(b.id, a.id, true);
  assert.equal(friendState(a.id, b.id), "friends");
  assert.ok(listFriends(b.id).some((u) => u.id === a.id));

  // Both reaching out makes friends without a formality.
  sendFriendRequest(a.id, c.id);
  sendFriendRequest(c.id, a.id);
  assert.equal(friendState(c.id, a.id), "friends");
});
