/**
 * Data access, and the server-side rules of engagement.
 *
 * This is where "the server is the authority" is actually enforced: who may
 * act, when they may act, and what the record says. It does NOT decide whether
 * a move is legal under the rules of Gygès — that is the engine's job and is
 * not wired up yet. See docs/ARCHITECTURE.md.
 */

import { getDb, newId, newToken, now, transaction } from "./index.ts";
import {
  applyMove,
  boardFromString,
  boardToString,
  checkMoveStructure,
  isGameOver,
  moveToString,
  startingBoard,
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
  created_at: number;
}

export interface Game {
  id: string;
  player1_id: string | null;
  player2_id: string | null;
  status: "open" | "active" | "finished";
  turn: Player;
  result: number | null;
  result_reason: string | null;
  board: string;
  ply: number;
  move_seconds: number;
  deadline_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface MoveRow {
  game_id: string;
  ply: number;
  player: Player;
  move: string;
  board_after: string;
  created_at: number;
}

export interface GameWithPlayers extends Game {
  player1_name: string | null;
  player2_name: string | null;
}

// ---------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------

export function createUser(username: string): User {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    throw new Error("Username must be between 2 and 24 characters.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error("Username may contain only letters, numbers, hyphens and underscores.");
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE username_key = ?")
    .get(trimmed.toLowerCase());
  if (existing) throw new Error("That username is taken.");

  const user: User = { id: newId(), username: trimmed, created_at: now() };
  db.prepare(
    "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
  ).run(user.id, user.username, trimmed.toLowerCase(), user.created_at);
  return user;
}

export function findUserByName(username: string): User | null {
  return (
    (getDb()
      .prepare("SELECT id, username, created_at FROM users WHERE username_key = ?")
      .get(username.trim().toLowerCase()) as User | undefined) ?? null
  );
}

export function getUser(id: string): User | null {
  return (
    (getDb()
      .prepare("SELECT id, username, created_at FROM users WHERE id = ?")
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
      `SELECT u.id, u.username, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?`,
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
  g.board, g.ply, g.move_seconds, g.deadline_at, g.created_at, g.updated_at,
  p1.username AS player1_name, p2.username AS player2_name
`;

const GAME_JOINS = `
  FROM games g
  LEFT JOIN users p1 ON p1.id = g.player1_id
  LEFT JOIN users p2 ON p2.id = g.player2_id
`;

export function createGame(creatorId: string, moveSeconds = 259200): Game {
  const board = encodeBoard(startingBoard());
  const game: Game = {
    id: newId(),
    player1_id: creatorId,
    player2_id: null,
    status: "open",
    turn: 1,
    result: null,
    result_reason: null,
    board,
    ply: 0,
    move_seconds: moveSeconds,
    deadline_at: null,
    created_at: now(),
    updated_at: now(),
  };

  getDb()
    .prepare(
      `INSERT INTO games
         (id, player1_id, player2_id, status, turn, board, ply, move_seconds, created_at, updated_at)
       VALUES (?, ?, NULL, 'open', 1, ?, 0, ?, ?, ?)`,
    )
    .run(game.id, creatorId, board, moveSeconds, game.created_at, game.updated_at);

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
    db.prepare(
      `UPDATE games
          SET player2_id = ?, status = 'active', deadline_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(userId, deadline, now(), gameId);

    return { ...game, player2_id: userId, status: "active" as const, deadline_at: deadline };
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

    db.prepare(
      `INSERT INTO moves (game_id, ply, player, move, board_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(gameId, ply, side, moveToString(mv), encoded, now());

    if (finished) {
      const won = winner(nextBoard);
      db.prepare(
        `UPDATE games
            SET board = ?, ply = ?, status = 'finished', result = ?, result_reason = 'goal',
                deadline_at = NULL, updated_at = ?
          WHERE id = ?`,
      ).run(encoded, ply, won, now(), gameId);
    } else {
      db.prepare(
        `UPDATE games
            SET board = ?, ply = ?, turn = ?, deadline_at = ?, updated_at = ?
          WHERE id = ?`,
      ).run(encoded, ply, -side, now() + game.move_seconds, now(), gameId);
    }

    return getGame(gameId)!;
  });
}

export function resignGame(gameId: string, userId: string): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as Game | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "active") throw new GameError("That game is not in progress.");

    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);

    db.prepare(
      `UPDATE games
          SET status = 'finished', result = ?, result_reason = 'resign',
              deadline_at = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(-side, now(), gameId);

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
  return transaction(() => {
    const db = getDb();
    const expired = db
      .prepare(
        `SELECT id, turn FROM games
          WHERE status = 'active' AND deadline_at IS NOT NULL AND deadline_at <= ?`,
      )
      .all(now()) as { id: string; turn: Player }[];

    const update = db.prepare(
      `UPDATE games
          SET status = 'finished', result = ?, result_reason = 'timeout',
              deadline_at = NULL, updated_at = ?
        WHERE id = ?`,
    );
    for (const g of expired) update.run(-g.turn, now(), g.id);
    return expired.length;
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
        GROUP BY u.id, u.username
        ORDER BY wins DESC, played ASC, u.username ASC
        LIMIT ?`,
    )
    .all(limit) as LeaderboardRow[];
}

export { boardFromString, boardToString };
