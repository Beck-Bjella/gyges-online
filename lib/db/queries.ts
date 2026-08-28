/**
 * Data access, and the server-side rules of engagement.
 *
 * This is where "the server is the authority" is actually enforced: who may
 * act, when they may act, and what the record says. It does NOT decide whether
 * a move is legal under the rules of Gygès — that is the engine's job and is
 * not wired up yet. See docs/ARCHITECTURE.md.
 */

import { getDb, newId, newToken, now, nowMs, transaction } from "./index.ts";
import {
  applyMove,
  applySetup,
  boardFromString,
  boardToString,
  checkMoveStructure,
  emptyBoard,
  isGameOver,
  isValidSetup,
  moveToString,
  winner,
  type BoardState,
  type Move,
  type Player,
} from "../game/board.ts";

const SESSION_DAYS = 30;

// ---------------------------------------------------------------------------
// Board <-> storage
//
// Stored as a 38-character digit string: cheap to store, trivially checkable
// by a CHECK constraint, and unambiguous.
// ---------------------------------------------------------------------------

export function encodeBoard(board: BoardState): string {
  return board.join("");
}

export function decodeBoard(s: string): BoardState {
  return Array.from(s, Number);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  username: string;
  /** Set when the account is closed. Games survive; personal fields do not. */
  deleted_at: number | null;
  created_at: number;
}

export interface Game {
  id: string;
  player1_id: string | null;
  player2_id: string | null;
  status: "open" | "setup" | "active" | "finished";
  turn: Player;
  result: number | null;
  result_reason: string | null;
  /** The position this game began from. Never changes. */
  start_board: string;
  board: string;
  ply: number;
  move_seconds: number;
  deadline_at: number | null;
  created_at: number;
  /** When the second player joined. Null while the game is open. */
  started_at: number | null;
  /** When the game ended. Null until finished. */
  finished_at: number | null;
  updated_at: number;
}

export interface MoveRow {
  game_id: string;
  ply: number;
  player: Player;
  /** 'setup' for a home-row arrangement, 'move' for ordinary play. */
  kind: "setup" | "move";
  move: string;
  board_after: string;
  /** Unix milliseconds. */
  created_at: number;
  /** How long this player took, in milliseconds. Null only if unknown. */
  think_ms: number | null;
}

export interface GameWithPlayers extends Game {
  player1_name: string | null;
  player2_name: string | null;
}

// ---------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------

/** Shared by createUser and renameUser. Returns the cleaned name. */
function validateUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    throw new Error("Username must be between 2 and 24 characters.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error("Username may contain only letters, numbers, hyphens and underscores.");
  }
  return trimmed;
}

export function createUser(username: string): User {
  const trimmed = validateUsername(username);

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE username_key = ?")
    .get(trimmed.toLowerCase());
  if (existing) throw new Error("That username is taken.");

  const user: User = {
    id: newId(),
    username: trimmed,
    deleted_at: null,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
  ).run(user.id, user.username, trimmed.toLowerCase(), user.created_at);
  return user;
}

/**
 * Change a username.
 *
 * This is a single-row update. Games reference users by id, never by name, so
 * every past game, move, and session follows the rename automatically — which
 * is the whole reason the schema stores ids rather than copies of the name.
 *
 * Changing case only ("beck" -> "Beck") is allowed, since the uniqueness key is
 * case-insensitive and would otherwise report the name as taken by yourself.
 */
export function renameUser(userId: string, newUsername: string): User {
  const trimmed = validateUsername(newUsername);
  const key = trimmed.toLowerCase();

  return transaction(() => {
    const db = getDb();
    const user = getUser(userId);
    if (!user) throw new GameError("No such account.", 404);
    if (user.deleted_at) throw new GameError("That account is closed.", 403);

    const clash = db
      .prepare("SELECT id FROM users WHERE username_key = ? AND id <> ?")
      .get(key, userId);
    if (clash) throw new GameError("That username is taken.");

    db.prepare("UPDATE users SET username = ?, username_key = ? WHERE id = ?").run(
      trimmed,
      key,
      userId,
    );

    return { ...user, username: trimmed };
  });
}

export function findUserByName(username: string): User | null {
  return (
    (getDb()
      .prepare(
        "SELECT id, username, deleted_at, created_at FROM users WHERE username_key = ?",
      )
      .get(username.trim().toLowerCase()) as User | undefined) ?? null
  );
}

export function getUser(id: string): User | null {
  return (
    (getDb()
      .prepare("SELECT id, username, deleted_at, created_at FROM users WHERE id = ?")
      .get(id) as User | undefined) ?? null
  );
}

export function createSession(userId: string): string {
  const token = newToken();
  getDb()
    .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now(), now() + SESSION_DAYS * 86400);
  return token;
}

export function userForSession(token: string | undefined): User | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.deleted_at, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    )
    .get(token, now()) as User | undefined;
  return row ?? null;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

const GAME_COLUMNS = `
  g.id, g.player1_id, g.player2_id, g.status, g.turn, g.result, g.result_reason,
  g.start_board, g.board, g.ply, g.move_seconds, g.deadline_at,
  g.created_at, g.started_at, g.finished_at, g.updated_at,
  p1.username AS player1_name, p2.username AS player2_name
`;

const GAME_JOINS = `
  FROM games g
  LEFT JOIN users p1 ON p1.id = g.player1_id
  LEFT JOIN users p2 ON p2.id = g.player2_id
`;

export function createGame(
  creatorId: string,
  moveSeconds = 259200,
  from: BoardState = emptyBoard(),
): Game {
  // A game begins from an empty board: both players arrange their home row
  // before play starts. See the setup section below.
  const board = encodeBoard(from);
  const game: Game = {
    id: newId(),
    player1_id: creatorId,
    player2_id: null,
    status: "open",
    turn: 1,
    result: null,
    result_reason: null,
    start_board: board,
    board,
    ply: 0,
    move_seconds: moveSeconds,
    deadline_at: null,
    created_at: now(),
    started_at: null,
    finished_at: null,
    updated_at: now(),
  };

  getDb()
    .prepare(
      `INSERT INTO games
         (id, player1_id, player2_id, status, turn, start_board, board, ply,
          move_seconds, created_at, updated_at)
       VALUES (?, ?, NULL, 'open', 1, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      game.id,
      creatorId,
      board,
      board,
      moveSeconds,
      game.created_at,
      game.updated_at,
    );

  return game;
}

export function getGame(id: string): GameWithPlayers | null {
  return (
    (getDb()
      .prepare(`SELECT ${GAME_COLUMNS} ${GAME_JOINS} WHERE g.id = ?`)
      .get(id) as GameWithPlayers | undefined) ?? null
  );
}

export function listOpenGames(excludeUserId?: string): GameWithPlayers[] {
  const db = getDb();
  if (excludeUserId) {
    return db
      .prepare(
        `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
          WHERE g.status = 'open' AND (g.player1_id IS NULL OR g.player1_id <> ?)
          ORDER BY g.created_at DESC LIMIT 50`,
      )
      .all(excludeUserId) as GameWithPlayers[];
  }
  return db
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.status = 'open' ORDER BY g.created_at DESC LIMIT 50`,
    )
    .all() as GameWithPlayers[];
}

/**
 * Games in progress, for anyone to watch.
 *
 * Excludes the viewer's own games, which already have their own list.
 */
export function listActiveGames(excludeUserId?: string, limit = 30): GameWithPlayers[] {
  const db = getDb();
  if (excludeUserId) {
    return db
      .prepare(
        `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
          WHERE g.status IN ('active', 'setup')
            AND g.player1_id <> ? AND g.player2_id <> ?
          ORDER BY g.updated_at DESC LIMIT ?`,
      )
      .all(excludeUserId, excludeUserId, limit) as GameWithPlayers[];
  }
  return db
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.status IN ('active', 'setup')
        ORDER BY g.updated_at DESC LIMIT ?`,
    )
    .all(limit) as GameWithPlayers[];
}

/**
 * Recently finished games, for the front page.
 */
export function listRecentFinishedGames(limit = 10): GameWithPlayers[] {
  return getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.status = 'finished'
        ORDER BY g.finished_at DESC LIMIT ?`,
    )
    .all(limit) as GameWithPlayers[];
}

/**
 * A cheap "has anything changed?" probe for a single game.
 *
 * Polled by the game page so a player sees their opponent's move without
 * reloading. Deliberately returns only what is needed to decide whether to
 * refresh — not the whole game — so the poll stays small.
 */
export function gameVersion(
  gameId: string,
): { ply: number; status: string; updated_at: number } | null {
  return (
    (getDb()
      .prepare("SELECT ply, status, updated_at FROM games WHERE id = ?")
      .get(gameId) as { ply: number; status: string; updated_at: number } | undefined) ??
    null
  );
}

export function listGamesForUser(userId: string): GameWithPlayers[] {
  return getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.player1_id = ? OR g.player2_id = ?
        ORDER BY
          CASE g.status WHEN 'active' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
          g.updated_at DESC
        LIMIT 100`,
    )
    .all(userId, userId) as GameWithPlayers[];
}

export function getMoves(gameId: string): MoveRow[] {
  return getDb()
    .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
    .all(gameId) as MoveRow[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function joinGame(gameId: string, userId: string): Game {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as Game | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "open") throw new GameError("That game is no longer open.");
    if (game.player1_id === userId) throw new GameError("You cannot join your own game.");
    if (game.player2_id) throw new GameError("That game already has two players.");

    const deadline = now() + game.move_seconds;
    const startedAt = now();
    db.prepare(
      `UPDATE games
          SET player2_id = ?, status = 'setup', deadline_at = ?,
              started_at = ?, updated_at = ?
        WHERE id = ? AND status = 'open' AND player2_id IS NULL`,
    ).run(userId, deadline, startedAt, now(), gameId);

    return {
      ...game,
      player2_id: userId,
      status: "setup" as const,
      deadline_at: deadline,
      started_at: startedAt,
    };
  });
}

/** Which side this user plays, or null if they are not a participant. */
export function sideOf(game: Game, userId: string | null): Player | null {
  if (!userId) return null;
  if (game.player1_id === userId) return 1;
  if (game.player2_id === userId) return -1;
  return null;
}

/**
 * Submit a home-row arrangement.
 *
 * The two setup plies are recorded in the moves table like any other action,
 * so a game replays from an empty board. They are marked kind='setup' because
 * they are not positions the engine can evaluate — it assumes twelve pieces,
 * and after player 1's setup there are six.
 *
 * Player 1 arranges first, then player 2, who can see what they are facing.
 * Once both are placed the game moves to 'active' and player 1 moves first.
 */
export function submitSetup(
  gameId: string,
  userId: string,
  arrangement: number[],
): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Game
      | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "setup") {
      throw new GameError("This game is not being set up.");
    }

    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);
    if (side !== game.turn) throw new GameError("It is not your turn to place.", 409);

    if (!isValidSetup(arrangement)) {
      throw new GameError("A setup must use each of the six pieces exactly once.");
    }

    const board = decodeBoard(game.board);
    const nextBoard = applySetup(board, side, arrangement);
    const encoded = encodeBoard(nextBoard);
    const ply = game.ply + 1;
    // Player 1 places first, so after player 2 places, both are done.
    const bothPlaced = ply >= 2;

    const at = nowMs();
    const previous = db
      .prepare("SELECT created_at FROM moves WHERE game_id = ? AND ply = ?")
      .get(gameId, game.ply) as { created_at: number } | undefined;
    const since = previous?.created_at ?? (game.started_at ?? now()) * 1000;

    db.prepare(
      `INSERT INTO moves
         (game_id, ply, player, kind, move, board_after, created_at, think_ms)
       VALUES (?, ?, ?, 'setup', ?, ?, ?, ?)`,
    ).run(gameId, ply, side, arrangement.join(""), encoded, at, Math.max(0, at - since));

    const result = db
      .prepare(
        `UPDATE games
            SET board = ?, ply = ?, status = ?, turn = ?, deadline_at = ?,
                updated_at = ?
          WHERE id = ? AND ply = ? AND turn = ? AND status = 'setup'`,
      )
      .run(
        encoded,
        ply,
        bothPlaced ? "active" : "setup",
        // Player 1 places, then player 2 places, then player 1 moves first.
        bothPlaced ? 1 : -1,
        now() + game.move_seconds,
        now(),
        gameId,
        game.ply,
        side,
      );

    if (result.changes === 0) {
      throw new GameError("Someone acted first — reload the game.", 409);
    }

    return getGame(gameId)!;
  });
}

/**
 * Submit a move.
 *
 * The server checks authority (is this your game, is it your turn) and that the
 * move is structurally coherent. It does NOT check the rules of Gygès — that
 * arrives with the engine service. Until then any structurally valid move is
 * accepted, which is a deliberate, documented choice.
 */
export function submitMove(gameId: string, userId: string, mv: Move): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as Game | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status === "setup") {
      throw new GameError("Both players must place their pieces first.");
    }
    if (game.status !== "active") throw new GameError("That game is not in progress.");

    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);
    if (side !== game.turn) throw new GameError("It is not your turn.", 409);

    const board = decodeBoard(game.board);
    const structure = checkMoveStructure(board, mv);
    if (!structure.ok) throw new GameError(structure.reason ?? "Malformed move.");

    // THE RULES CHECK GOES HERE.
    //
    // Everything above establishes authority: the game exists, it is running,
    // you are a player, it is your turn, and the move is structurally coherent.
    // What is missing is whether the move is *legal* under the rules of Gygès.
    //
    // When the engine service exists this becomes roughly:
    //
    //     const verdict = await validateMove(board, side, mv);
    //     if (!verdict.legal) throw new GameError(verdict.reason ?? "Illegal move.");
    //
    // using lib/engine/client.ts. Note that submitMove would have to become
    // async, since the engine is reached over the network. Nothing else about
    // the flow changes, and stored games stay readable — see
    // docs/ARCHITECTURE.md.

    const nextBoard = applyMove(board, mv);
    const encoded = encodeBoard(nextBoard);
    const ply = game.ply + 1;
    const finished = isGameOver(nextBoard);

    // Think time: the gap since the previous move, or since the game started
    // for the first move. Stored rather than derived, because the baseline for
    // ply 1 lives on the game row and a future pause feature would make the
    // raw gap misleading.
    const at = nowMs();
    const previous = db
      .prepare("SELECT created_at FROM moves WHERE game_id = ? AND ply = ?")
      .get(gameId, game.ply) as { created_at: number } | undefined;
    const since = previous?.created_at ?? (game.started_at ?? now()) * 1000;
    const thinkMs = Math.max(0, at - since);

    db.prepare(
      `INSERT INTO moves
         (game_id, ply, player, kind, move, board_after, created_at, think_ms)
       VALUES (?, ?, ?, 'move', ?, ?, ?, ?)`,
    ).run(gameId, ply, side, moveToString(mv), encoded, at, thinkMs);

    // Optimistic concurrency: the UPDATE only applies if the game is still in
    // the state we read at the top. If another request moved first, zero rows
    // change and we abort rather than overwriting their move. The same
    // condition works on SQLite and Postgres, so this survives the migration.
    const guard = "WHERE id = ? AND ply = ? AND turn = ? AND status = 'active'";
    const expectedPly = game.ply;

    const result = finished
      ? db
          .prepare(
            `UPDATE games
                SET board = ?, ply = ?, status = 'finished', result = ?,
                    result_reason = 'goal', deadline_at = NULL,
                    finished_at = ?, updated_at = ?
              ${guard}`,
          )
          .run(encoded, ply, winner(nextBoard), now(), now(), gameId, expectedPly, side)
      : db
          .prepare(
            `UPDATE games
                SET board = ?, ply = ?, turn = ?, deadline_at = ?, updated_at = ?
              ${guard}`,
          )
          .run(
            encoded,
            ply,
            -side,
            now() + game.move_seconds,
            now(),
            gameId,
            expectedPly,
            side,
          );

    if (result.changes === 0) {
      throw new GameError("Someone moved first — reload the game.", 409);
    }

    return getGame(gameId)!;
  });
}

export function resignGame(gameId: string, userId: string): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as Game | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "active" && game.status !== "setup") {
      throw new GameError("That game is not in progress.");
    }

    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);

    db.prepare(
      `UPDATE games
          SET status = 'finished', result = ?, result_reason = 'resign',
              deadline_at = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('active', 'setup')`,
    ).run(-side, now(), now(), gameId);

    return getGame(gameId)!;
  });
}

/**
 * Settle games whose move deadline has passed.
 *
 * Called opportunistically whenever games are listed or loaded, rather than
 * relying on a scheduled job. Vercel's free tier only runs cron once a day, so
 * resolving lazily keeps deadlines accurate without one; a periodic job can be
 * added later as a backstop for games nobody opens.
 */
export function settleExpiredGames(): number {
  const db = getDb();

  // Check with a plain read first. This runs on every page load, and almost
  // always finds nothing — opening a write transaction each time would
  // serialise every reader behind a writer for no reason.
  const expired = db
    .prepare(
      `SELECT id, turn FROM games
        WHERE status IN ('active', 'setup')
          AND deadline_at IS NOT NULL AND deadline_at <= ?`,
    )
    .all(now()) as { id: string; turn: Player }[];

  if (expired.length === 0) return 0;

  return transaction(() => {
    const update = db.prepare(
      `UPDATE games
          SET status = 'finished', result = ?, result_reason = 'timeout',
              deadline_at = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('active', 'setup') AND deadline_at <= ?`,
    );
    let settled = 0;
    for (const g of expired) {
      // Re-check inside the transaction: a player may have moved in between.
      settled += update.run(-g.turn, now(), now(), g.id, now()).changes;
    }
    return settled;
  });
}

// ---------------------------------------------------------------------------
// Leaderboard
//
// A plain win count for now. Ratings wait for move validation, since ranking
// players is meaningless while illegal moves are accepted.
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  id: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
}

export interface PlayerStats {
  user: User;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  active: number;
}

/** A player's public record. Returns null for an unknown name. */
export function playerStats(username: string): PlayerStats | null {
  const user = findUserByName(username);
  if (!user) return null;

  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN g.status = 'finished' AND
                       ((g.player1_id = ? AND g.result = 1)
                     OR (g.player2_id = ? AND g.result = -1)) THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN g.status = 'finished' AND
                       ((g.player1_id = ? AND g.result = -1)
                     OR (g.player2_id = ? AND g.result = 1)) THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN g.status = 'finished' AND g.result = 0 THEN 1 ELSE 0 END) AS draws,
         SUM(CASE WHEN g.status = 'finished' THEN 1 ELSE 0 END) AS played,
         SUM(CASE WHEN g.status IN ('active', 'setup') THEN 1 ELSE 0 END) AS active
       FROM games g
      WHERE g.player1_id = ? OR g.player2_id = ?`,
    )
    .get(user.id, user.id, user.id, user.id, user.id, user.id) as {
    wins: number | null;
    losses: number | null;
    draws: number | null;
    played: number | null;
    active: number | null;
  };

  return {
    user,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    draws: row.draws ?? 0,
    played: row.played ?? 0,
    active: row.active ?? 0,
  };
}

/** A player's finished games, most recent first. */
export function finishedGamesForUser(userId: string, limit = 25): GameWithPlayers[] {
  return getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE (g.player1_id = ? OR g.player2_id = ?) AND g.status = 'finished'
        ORDER BY g.updated_at DESC
        LIMIT ?`,
    )
    .all(userId, userId, limit) as GameWithPlayers[];
}

/** How many games are waiting on this player to move. */
export function gamesAwaitingUser(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM games
        WHERE status IN ('active', 'setup')
          AND ((player1_id = ? AND turn = 1) OR (player2_id = ? AND turn = -1))`,
    )
    .get(userId, userId) as { n: number };
  return row.n;
}

/**
 * Timing statistics for a player.
 *
 * Everything here is computed from moves.think_ms, which is recorded per move.
 * This exists partly to prove the stored data supports the stats we will want
 * later — median think time, moves per day, longest game — without another
 * schema change.
 */
export interface TimingStats {
  moves: number;
  medianThinkMs: number | null;
  fastestMs: number | null;
  slowestMs: number | null;
}

export function timingStats(userId: string): TimingStats {
  const rows = getDb()
    .prepare(
      `SELECT m.think_ms AS t
         FROM moves m
         JOIN games g ON g.id = m.game_id
        WHERE m.think_ms IS NOT NULL
          AND ((g.player1_id = ? AND m.player = 1)
            OR (g.player2_id = ? AND m.player = -1))
        ORDER BY m.think_ms ASC`,
    )
    .all(userId, userId) as { t: number }[];

  if (rows.length === 0) {
    return { moves: 0, medianThinkMs: null, fastestMs: null, slowestMs: null };
  }

  return {
    moves: rows.length,
    medianThinkMs: rows[Math.floor(rows.length / 2)].t,
    fastestMs: rows[0].t,
    slowestMs: rows[rows.length - 1].t,
  };
}

export function leaderboard(limit = 25): LeaderboardRow[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.username,
              SUM(CASE WHEN (g.player1_id = u.id AND g.result = 1)
                         OR (g.player2_id = u.id AND g.result = -1) THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN (g.player1_id = u.id AND g.result = -1)
                         OR (g.player2_id = u.id AND g.result = 1) THEN 1 ELSE 0 END) AS losses,
              SUM(CASE WHEN g.result = 0 THEN 1 ELSE 0 END) AS draws,
              COUNT(g.id) AS played
         FROM users u
         JOIN games g
           ON (g.player1_id = u.id OR g.player2_id = u.id) AND g.status = 'finished'
        WHERE u.deleted_at IS NULL
        GROUP BY u.id, u.username
        ORDER BY wins DESC, played ASC, u.username ASC
        LIMIT ?`,
    )
    .all(limit) as LeaderboardRow[];
}

export { boardFromString, boardToString };
