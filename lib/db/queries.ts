/**
 * Data access, and the server-side rules of engagement.
 *
 * This is where "the server is the authority" is actually enforced: who may
 * act, when they may act, and what the record says. Move legality is enforced
 * here too, by calling lib/game/rules.ts — but the rules themselves live there,
 * not in this file and not in the schema. See docs/ARCHITECTURE.md.
 */

import { getDb, newId, newToken, now, nowMs, transaction } from "./index.ts";
import {
  applyMove,
  applySetup,
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
import { checkMoveLegality } from "../game/rules.ts";

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
  /**
   * Whether this account has a password.
   *
   * Note what is NOT here: the hash itself. `User` is handed to pages and, from
   * there, to client components, so the hash must never be a field on it — the
   * safest way to guarantee that is for no query building a `User` to select
   * it. Only passwordHashFor() reads the hash, and only lib/auth.ts calls it.
   *
   * False only for bots, which have no password and cannot be signed in to.
   */
  has_password: boolean;
  /**
   * The engine strength this bot plays at, or null for a human.
   *
   * A bot is an ordinary account — this column is what distinguishes one, and
   * it is deliberately the only thing that does. Profiles, game history and
   * replay are shared code that never asks.
   */
  bot_strength: number | null;
  /** How this bot plays, shown on its profile. Null for humans. */
  bot_description: string | null;
  /**
   * The UGI options this bot plays with, applied verbatim before its search.
   *
   * Opaque to the site on purpose: these are `setoption` names and values, so
   * a new engine option needs no migration here. The one the site cares about
   * is `maxNodes` — bounding the search by WORK rather than time is what makes
   * the same bot play the same move on every device. A slow phone waits longer
   * than a desktop; it does not face a weaker opponent.
   */
  bot_options: Record<string, string | number | boolean> | null;
  /**
   * Which engine build this bot belongs to.
   *
   * The browser build fixes its transposition table size and evaluation network
   * at compile time, so a bot is reproducible only *within* a build. Recording
   * it keeps a future engine release from silently invalidating the record of
   * games played against the old one.
   */
  bot_engine_build: string | null;
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
  /** Reserved second seat: only this user may join. Null for a public game. */
  invited_id: string | null;
  /** 1 while the winner of a goal-ended game is offering the loser a rewind. */
  takeback_offered: number;
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
  /** Who the reserved seat is for, when this is a challenge. */
  invited_name: string | null;
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

/**
 * Create an account.
 *
 * `passwordHash` is optional only so that bots — which have no password and
 * cannot be signed in to — and test fixtures can be created. Every account made
 * through the site has one.
 *
 * The INSERT is guarded by the UNIQUE index on username_key, not only by the
 * SELECT above it. Two simultaneous sign-ups for the same free name would both
 * pass the SELECT; the index is what actually stops the second one.
 */
export function createUser(username: string, passwordHash?: string): User {
  const trimmed = validateUsername(username);

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE username_key = ?")
    .get(trimmed.toLowerCase());
  if (existing) throw new GameError("That username is taken.");

  const user: User = {
    id: newId(),
    username: trimmed,
    deleted_at: null,
    created_at: now(),
    has_password: Boolean(passwordHash),
    bot_strength: null,
    bot_description: null,
    bot_options: null,
    bot_engine_build: null,
  };
  try {
    db.prepare(
      `INSERT INTO users (id, username, username_key, created_at, password_hash, password_set_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      user.id,
      user.username,
      trimmed.toLowerCase(),
      user.created_at,
      passwordHash ?? null,
      passwordHash ? user.created_at : null,
    );
  } catch (err) {
    // The unique index fired: someone took this name between the check and the
    // insert. Report it the same way as the check would have.
    if (String(err).includes("UNIQUE")) {
      throw new GameError("That username is taken.");
    }
    throw err;
  }
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

/**
 * The columns every User-returning query selects.
 *
 * `password_hash IS NOT NULL` rather than the hash itself: callers learn
 * whether a password exists, never what it is. SQLite yields 0/1 here and
 * Postgres yields a real boolean, so both are normalised in toUser().
 */
const USER_COLUMNS = `
  id, username, deleted_at, created_at,
  bot_strength, bot_description, bot_options, bot_engine_build,
  (password_hash IS NOT NULL) AS has_password
`;

/**
 * Parse the stored UGI options.
 *
 * Returns null rather than throwing on malformed JSON: one bad row must not
 * break the leaderboard for everyone. A bot with unreadable options simply has
 * none, and the caller can refuse to run it.
 */
function parseBotOptions(
  raw: string | null,
): Record<string, string | number | boolean> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string | number | boolean>;
  } catch {
    return null;
  }
}

/** Normalise a users row into a User. */
function toUser(row: Record<string, unknown> | undefined): User | null {
  if (!row) return null;
  return {
    id: row.id as string,
    username: row.username as string,
    deleted_at: (row.deleted_at as number | null) ?? null,
    created_at: row.created_at as number,
    has_password: Boolean(row.has_password),
    bot_strength: (row.bot_strength as number | null) ?? null,
    bot_description: (row.bot_description as string | null) ?? null,
    bot_options: parseBotOptions(row.bot_options as string | null),
    bot_engine_build: (row.bot_engine_build as string | null) ?? null,
  };
}

export function findUserByName(username: string): User | null {
  return toUser(
    getDb()
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username_key = ?`)
      .get(username.trim().toLowerCase()) as Record<string, unknown> | undefined,
  );
}

export function getUser(id: string): User | null {
  return toUser(
    getDb()
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined,
  );
}

/**
 * The stored password hash for an account, or null if it has none.
 *
 * Deliberately separate from every other user query, and deliberately not a
 * field on `User`. This is the only function that reads the column, and
 * lib/auth.ts is the only caller — which is what keeps a hash from ever
 * reaching a page, a prop, or a JSON response by accident.
 */
export function passwordHashFor(userId: string): string | null {
  const row = getDb()
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(userId) as { password_hash: string | null } | undefined;
  return row?.password_hash ?? null;
}

/**
 * Set or replace an account's password.
 *
 * Takes an already-computed hash: hashing is slow and async, and this layer is
 * synchronous and runs inside transactions. Doing the work in lib/auth.ts and
 * passing the result keeps a 120ms CPU burn out of a database transaction.
 */
export function setPasswordHash(userId: string, hash: string): void {
  const result = getDb()
    .prepare("UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?")
    .run(hash, now(), userId);
  if (result.changes === 0) throw new GameError("No such account.", 404);
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
      `SELECT u.id, u.username, u.deleted_at, u.created_at,
              (u.password_hash IS NOT NULL) AS has_password
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    )
    .get(token, now()) as Record<string, unknown> | undefined;
  return toUser(row);
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/**
 * End every session for a user.
 *
 * Called when a password changes: someone changing their password because they
 * think it was stolen expects that to log the thief out. Leaving old sessions
 * valid would make the change nearly pointless.
 *
 * `except` keeps the current session alive so the person doing it is not
 * logged out of their own browser.
 */
export function deleteSessionsForUser(userId: string, except?: string): number {
  const db = getDb();
  const result = except
    ? db
        .prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?")
        .run(userId, except)
    : db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return result.changes;
}

/**
 * Delete sessions that have expired.
 *
 * The roadmap listed this as "session hygiene to fix at the same time" as
 * passwords: the index on sessions(expires_at) already existed, but nothing
 * ever ran the delete, so the table grew without bound.
 *
 * Called opportunistically on sign-in rather than from a scheduled job, for the
 * same reason lazy settling once was — Vercel's free tier runs cron once a
 * day. Sign-in is a good moment: it is not a hot path, and it already writes.
 */
export function purgeExpiredSessions(): number {
  return getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now())
    .changes;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

const GAME_COLUMNS = `
  g.id, g.player1_id, g.player2_id, g.status, g.turn, g.result, g.result_reason,
  g.start_board, g.board, g.ply, g.move_seconds, g.deadline_at,
  g.created_at, g.started_at, g.finished_at, g.updated_at, g.invited_id,
  g.takeback_offered,
  p1.username AS player1_name, p2.username AS player2_name,
  inv.username AS invited_name
`;

const GAME_JOINS = `
  FROM games g
  LEFT JOIN users p1 ON p1.id = g.player1_id
  LEFT JOIN users p2 ON p2.id = g.player2_id
  LEFT JOIN users inv ON inv.id = g.invited_id
`;

/**
 * Who moves first, once both home rows are placed.
 *
 * Moving first is a real advantage in Gyges, and handing it to whoever happened
 * to create the game made every game start the same way.
 */
function firstMover(): Player {
  return Math.random() < 0.5 ? 1 : -1;
}

/** The most unfinished games — open, setting up, or active — one person may hold. */
export const MAX_OPEN_GAMES = 10;

/**
 * Refuse a new seat for someone already holding MAX_OPEN_GAMES.
 *
 * A spam guard, so the cap counts EVERYTHING unfinished, bot games included —
 * ten cheap engine games fill the server as surely as ten human ones. The one
 * exemption is the bot accounts themselves: a bot plays everyone at once, and
 * capping it would break every eleventh game against the ladder. A challenge
 * counts against its sender from the moment it is sent, but against the
 * invited player only once they accept.
 */
function assertRoomForGame(userId: string): void {
  if (getUser(userId)?.bot_strength != null) return;
  if (openSeatCount(userId) >= MAX_OPEN_GAMES) {
    throw new GameError(
      `You already have ${MAX_OPEN_GAMES} games going. Finish one first.`,
    );
  }
}

export function createGame(
  creatorId: string,
  moveSeconds = 259200,
  from: BoardState = emptyBoard(),
): Game {
  assertRoomForGame(creatorId);

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
    invited_id: null,
    takeback_offered: 0,
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

/**
 * Every game waiting for a second player.
 *
 * Includes the viewer's own, marked rather than hidden: someone who has just
 * hosted a game should be able to see it sitting in the list. Joining your own
 * is refused by joinGame regardless.
 */
export function listOpenGames(): GameWithPlayers[] {
  return getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.status = 'open' AND g.invited_id IS NULL ORDER BY g.created_at DESC LIMIT 50`,
    )
    .all() as GameWithPlayers[];
}

/**
 * Every game in progress.
 *
 * Deliberately includes the viewer's own games. "In progress" should mean the
 * same thing to everyone looking at it — a list that silently omits your games
 * is confusing, and the caller can mark them instead.
 */
export function listActiveGames(limit = 30): GameWithPlayers[] {
  return getDb()
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
 * A cheap "has anything changed on the site?" probe.
 *
 * The lobby and dashboard need to notice a game being created, joined, moved
 * in or finished. Rather than re-render those pages on a timer, they poll this
 * and refresh only when the answer differs from what they were rendered with.
 *
 * Counts by status catch a game appearing or changing phase; the newest
 * updated_at catches everything else, including moves within a game already in
 * the list. Together they are one row from one scan, and about fifty bytes on
 * the wire.
 */
export function siteVersion(): string {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status IN ('setup', 'active') THEN 1 ELSE 0 END) AS playing,
         SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
         MAX(updated_at) AS latest
       FROM games`,
    )
    .get() as {
    open: number | null;
    playing: number | null;
    finished: number | null;
    latest: number | null;
  };
  // One opaque string rather than an object: the page and the probe both call
  // this, so they cannot disagree about formatting, and the caller compares it
  // with a plain equality check rather than knowing what the parts mean.
  return [row.open ?? 0, row.playing ?? 0, row.finished ?? 0, row.latest ?? 0].join(":");
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
    if (game.invited_id && game.invited_id !== userId) {
      throw new GameError("That game is reserved for someone else.", 403);
    }
    assertRoomForGame(userId);

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

/**
 * An open game reserved for one opponent.
 *
 * A challenge is an ordinary open game with the second seat held, so joining,
 * setup, deadlines and everything downstream are the code that already exists.
 * It does not appear in the public lobby; the invited player sees it on their
 * dashboard and accepts by joining.
 */
export function createChallenge(
  creatorId: string,
  invitedId: string,
  moveSeconds = 259200,
): Game {
  return transaction(() => {
    const other = getUser(invitedId);
    if (!other || other.deleted_at) throw new GameError("No such player.", 404);
    if (other.bot_strength !== null) {
      throw new GameError("Challenge a bot by starting a game from the lobby.");
    }
    if (other.id === creatorId) throw new GameError("You cannot challenge yourself.");

    const game = createGame(creatorId, moveSeconds);
    getDb()
      .prepare("UPDATE games SET invited_id = ?, updated_at = ? WHERE id = ?")
      .run(invitedId, now(), game.id);
    return { ...game, invited_id: invitedId };
  });
}

/**
 * Turn a challenge down. The game is deleted, exactly as if its creator had
 * cancelled: it never started, so there is nothing a record would keep, and
 * leaving it to rot in the sender's waiting list would be worse than an
 * answer.
 */
export function declineChallenge(gameId: string, userId: string): void {
  const done = getDb()
    .prepare(`DELETE FROM games WHERE id = ? AND invited_id = ? AND status = 'open'`)
    .run(gameId, userId);
  if (done.changes === 0) throw new GameError("No such challenge.", 404);
}

/** Challenges waiting for this player to accept. */
export function listIncomingChallenges(userId: string): GameWithPlayers[] {
  return getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.status = 'open' AND g.invited_id = ?
        ORDER BY g.created_at DESC`,
    )
    .all(userId) as GameWithPlayers[];
}


/** Challenges this player has sent that nobody has answered. */
export function listOutgoingChallenges(userId: string): GameWithPlayers[] {
  return getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} ${GAME_JOINS}
        WHERE g.status = 'open' AND g.player1_id = ? AND g.invited_id IS NOT NULL
        ORDER BY g.created_at DESC`,
    )
    .all(userId) as GameWithPlayers[];
}

/**
 * Everything the dashboard watches, folded into one opaque string.
 *
 * The site-wide version only sees the games table, but a dashboard also
 * changes when a friend request lands, a friendship forms, or a challenge
 * appears — so this folds those in, scoped to one player. Same contract as
 * siteVersion: the page renders with it, the probe re-asks, plain equality
 * decides.
 */
export function dashboardVersion(userId: string): string {
  const db = getDb();
  const games = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS latest
         FROM games
        WHERE player1_id = @id OR player2_id = @id OR invited_id = @id`,
    )
    .get({ id: userId }) as { n: number; latest: number };
  const social = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS friends,
         SUM(CASE WHEN status = 'pending' AND addressee_id = @id THEN 1 ELSE 0 END) AS asks
         FROM friends
        WHERE requester_id = @id OR addressee_id = @id`,
    )
    .get({ id: userId }) as { friends: number | null; asks: number | null };
  return [games.n, games.latest, social.friends ?? 0, social.asks ?? 0].join(":");
}

// --- chat ------------------------------------------------------------------

export interface ChatMessage {
  id: number;
  game_id: string | null;
  user_id: string;
  username: string;
  body: string;
  created_at: number;
}

/** The longest message anyone may send. Matches the CHECK in the schema. */
export const CHAT_MAX_LENGTH = 500;

/**
 * Post to a game's private chat, or to the lobby when gameId is null.
 *
 * A game's chat belongs to its two players and nobody else — not spectators,
 * who can already talk in the lobby. Any game state is fine, finished
 * included: the conversation about a game outlives it.
 *
 * The flood rule is deliberately crude: one message a second per author per
 * scope. It stops a stuck loop or a paste gone wrong without ever being felt
 * by a person typing.
 */
export function postChatMessage(
  userId: string,
  gameId: string | null,
  body: string,
): ChatMessage {
  return transaction(() => {
    const db = getDb();
    const text = body.trim();
    if (text.length === 0) throw new GameError("Say something.");
    if (text.length > CHAT_MAX_LENGTH) {
      throw new GameError(`Messages are capped at ${CHAT_MAX_LENGTH} characters.`);
    }

    if (gameId !== null) {
      const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
        | Game
        | undefined;
      if (!game) throw new GameError("Game not found.", 404);
      if (sideOf(game, userId) === null) {
        throw new GameError("This chat belongs to the players.", 403);
      }
    }

    const last = db
      .prepare(
        `SELECT created_at FROM chat_messages
          WHERE user_id = ? AND game_id IS ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(userId, gameId) as { created_at: number } | undefined;
    if (last && nowMs() - last.created_at < 1000) {
      throw new GameError("One message a second.", 429);
    }

    const at = nowMs();
    const inserted = db
      .prepare(
        `INSERT INTO chat_messages (game_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(gameId, userId, text, at);
    return {
      id: Number(inserted.lastInsertRowid),
      game_id: gameId,
      user_id: userId,
      username: getUser(userId)?.username ?? "—",
      body: text,
      created_at: at,
    };
  });
}

/**
 * Messages in a scope after a cursor, oldest first.
 *
 * `after = 0` is the initial load and returns only the most recent `limit`,
 * so an old lobby does not arrive in its entirety; every later poll passes
 * the last id it has and receives just what is new. Access is the caller's
 * responsibility — the route knows who is asking, this function does not.
 */
export function listChatMessages(
  gameId: string | null,
  after = 0,
  limit = 100,
): ChatMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.game_id, c.user_id, c.body, c.created_at,
              u.username
         FROM chat_messages c
         JOIN users u ON u.id = c.user_id
        WHERE c.game_id IS ? AND c.id > ?
        ORDER BY c.id DESC
        LIMIT ?`,
    )
    .all(gameId, after, limit) as ChatMessage[];
  return rows.reverse();
}

// --- friends ---------------------------------------------------------------

export type FriendState = "none" | "sent" | "received" | "friends";

/** Where two people stand, from `userId`'s side. */
export function friendState(userId: string, otherId: string): FriendState {
  const row = getDb()
    .prepare(
      `SELECT requester_id, status FROM friends
        WHERE (requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?)`,
    )
    .get(userId, otherId, otherId, userId) as
    | { requester_id: string; status: string }
    | undefined;
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return row.requester_id === userId ? "sent" : "received";
}

/**
 * Ask to be friends. Asking someone who has already asked you accepts —
 * two people who both reached out should not be left waiting on a formality.
 */
export function sendFriendRequest(userId: string, otherId: string): FriendState {
  return transaction(() => {
    const other = getUser(otherId);
    if (!other || other.deleted_at) throw new GameError("No such player.", 404);
    if (other.bot_strength !== null) throw new GameError("Bots have no friends list.");
    if (other.id === userId) throw new GameError("That would be you.");

    const state = friendState(userId, otherId);
    if (state === "friends" || state === "sent") return state;
    const db = getDb();
    if (state === "received") {
      db.prepare(
        `UPDATE friends SET status = 'accepted'
          WHERE requester_id = ? AND addressee_id = ?`,
      ).run(otherId, userId);
      return "friends";
    }
    db.prepare(
      `INSERT INTO friends (requester_id, addressee_id, status, created_at)
       VALUES (?, ?, 'pending', ?)`,
    ).run(userId, otherId, now());
    return "sent";
  });
}

/** Answer a request addressed to you. Declining deletes it — no list of rejections. */
export function respondToFriendRequest(
  userId: string,
  requesterId: string,
  accept: boolean,
): void {
  const db = getDb();
  const done = accept
    ? db
        .prepare(
          `UPDATE friends SET status = 'accepted'
            WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
        )
        .run(requesterId, userId)
    : db
        .prepare(
          `DELETE FROM friends
            WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
        )
        .run(requesterId, userId);
  if (done.changes === 0) throw new GameError("No such request.", 404);
}

/** End a friendship, from either side. The row goes; asking again works. */
export function removeFriend(userId: string, otherId: string): void {
  const done = getDb()
    .prepare(
      `DELETE FROM friends
        WHERE status = 'accepted'
          AND ((requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?))`,
    )
    .run(userId, otherId, otherId, userId);
  if (done.changes === 0) throw new GameError("You are not friends.", 404);
}

/** Everyone this player is friends with. */
export function listFriends(userId: string): User[] {
  return getDb()
    .prepare(
      `SELECT u.* FROM friends f
         JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id
                                     ELSE f.requester_id END
        WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
          AND u.deleted_at IS NULL
        ORDER BY u.username`,
    )
    .all(userId, userId, userId) as User[];
}

/** Requests waiting for this player's answer. */
export function listFriendRequests(userId: string): User[] {
  return getDb()
    .prepare(
      `SELECT u.* FROM friends f
         JOIN users u ON u.id = f.requester_id
        WHERE f.addressee_id = ? AND f.status = 'pending' AND u.deleted_at IS NULL
        ORDER BY f.created_at`,
    )
    .all(userId) as User[];
}

/**
 * Withdraw a table nobody has sat down at.
 *
 * Only the creator, and only while the game is still open — the moment an
 * opponent joins there is a second person with a stake in it, and ending it
 * then is what resigning is for. Deleted outright rather than marked: an open
 * game has no moves, no result and no history, so there is nothing a record
 * would preserve.
 */
export function cancelGame(gameId: string, userId: string): void {
  const done = getDb()
    .prepare(`DELETE FROM games WHERE id = ? AND player1_id = ? AND status = 'open'`)
    .run(gameId, userId);
  if (done.changes === 0) {
    throw new GameError("Only the creator can cancel, and only before anyone joins.", 409);
  }
}

/** How many unfinished games this player is seated at, against MAX_OPEN_GAMES. */
export function openSeatCount(userId: string): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM games
          WHERE (player1_id = ? OR player2_id = ?) AND status != 'finished'`,
      )
      .get(userId, userId) as { n: number }
  ).n;
}

/** One row per opponent this player has finished a game against. */
export interface OpponentRecord extends Record_ {
  id: string;
  username: string;
  isBot: boolean;
}

/**
 * The player's record broken out by opponent, most-played first.
 *
 * Bots included and marked — a per-opponent record is exactly what a fixed
 * opponent makes meaningful — so the profile can render them apart.
 */
export function opponentRecords(userId: string): OpponentRecord[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.username,
              u.bot_strength IS NOT NULL AS isBot,
              SUM(CASE WHEN (g.player1_id = @id AND g.result = 1)
                         OR (g.player2_id = @id AND g.result = -1) THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN (g.player1_id = @id AND g.result = -1)
                         OR (g.player2_id = @id AND g.result = 1) THEN 1 ELSE 0 END) AS losses,
              SUM(CASE WHEN g.result = 0 THEN 1 ELSE 0 END) AS draws,
              COUNT(g.id) AS played
         FROM games g
         JOIN users u
           ON u.id = CASE WHEN g.player1_id = @id THEN g.player2_id
                          ELSE g.player1_id END
        WHERE (g.player1_id = @id OR g.player2_id = @id)
          AND g.status = 'finished'
        GROUP BY u.id, u.username
        ORDER BY played DESC, u.username ASC`,
    )
    .all({ id: userId }) as OpponentRecord[];
}

/**
 * Create a game against a bot, already past the join step.
 *
 * An ordinary game in every respect — same table, same rules, same validation.
 * The only difference from createGame + joinGame is that the second seat is
 * filled immediately, because a bot does not browse the lobby.
 *
 * The human is player 1 and moves first, which also means the human places
 * first during setup.
 */
export function createBotGame(
  userId: string,
  botId: string,
  moveSeconds = 259200,
): Game {
  return transaction(() => {
    const bot = getUser(botId);
    if (!bot || bot.bot_strength === null) {
      throw new GameError("That opponent is not an engine account.", 404);
    }
    if (bot.deleted_at) throw new GameError("That bot is retired.", 410);
    if (bot.id === userId) throw new GameError("You cannot play yourself.");

    const game = createGame(userId, moveSeconds);
    return joinGame(game.id, botId);
  });
}

/**
 * The bot seated in this game, or null if both players are people.
 *
 * Used to decide whether the browser should be running a search at all.
 */
export function botInGame(game: Game): User | null {
  for (const id of [game.player1_id, game.player2_id]) {
    if (!id) continue;
    const user = getUser(id);
    if (user && user.bot_strength !== null) return user;
  }
  return null;
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
        // Player 1 places, then player 2 places, then the first move goes to
        // whichever side the coin says.
        //
        // Chosen here rather than at creation because setup order is fixed —
        // player 1 arranges first either way — and because this is the moment
        // it stops being decided and starts being recorded. Drawn once and
        // written inside the transaction, so a retry cannot reroll it.
        //
        // Safe for replay: the moves table records `player` on every ply, so
        // history never infers a side from whether the ply number is odd.
        bothPlaced ? firstMover() : -1,
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
 * The server checks authority — is this your game, is it your turn — and then
 * that the move is legal under the rules of Gygès, via lib/game/rules.ts.
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

    // The rules check. checkMoveLegality re-checks structure itself, so there
    // is no separate structural pass here. Everything above establishes authority — the game
    // exists, it is running, you are a player, it is your turn, and the move is
    // structurally coherent. This is the part that asks whether the rules of
    // Gygès actually allow it.
    //
    // It runs in-process rather than over HTTP to an engine service. Legality
    // is a bounded search over 36 squares (lib/game/rules.ts); a network call
    // would add a hosting bill, a hop per move, and a way for the site to break
    // when the engine is down, in exchange for nothing. The engine remains the
    // better authority for *search* — that is what bot play needs — and
    // lib/engine/client.ts is unchanged for when it arrives.
    const verdict = checkMoveLegality(board, side, mv);
    if (!verdict.legal) throw new GameError(verdict.reason ?? "Illegal move.");

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

/**
 * Walk away from a game still being set up. Either player, and the game is
 * DELETED — with only home rows placed nothing has happened worth recording,
 * so unlike a resignation it leaves no result and touches no statistics.
 * Resigning is for games where play has begun.
 */
export function abandonGame(gameId: string, userId: string): void {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Game
      | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "setup") {
      throw new GameError("Abandoning is for games still being set up.");
    }
    if (sideOf(game, userId) === null) {
      throw new GameError("You are not a player in this game.", 403);
    }
    db.prepare("DELETE FROM games WHERE id = ?").run(gameId);
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
 * Take your own last move back, in a game against the engine.
 *
 * Bot games only. Undoes two plies — the bot's reply and your move beneath
 * it, since undoing only the reply would have the bot immediately replay it:
 * a bot's choice is a function of the position. A bot needs no consent, which
 * is exactly why this is instant here and an offer between people — see
 * offerTakeback.
 *
 * History is genuinely rewritten — the rows are deleted, not marked. Keeping
 * a retracted move around would make every consumer of history reason about
 * whether a ply "really happened".
 */
export function undoTurn(gameId: string, userId: string): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Game
      | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "active") throw new GameError("That game is not in progress.");

    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);
    if (side !== game.turn) {
      throw new GameError("Only the player to move can give a turn back.", 409);
    }

    const last = db
      .prepare(
        `SELECT ply, player, kind FROM moves
          WHERE game_id = ? ORDER BY ply DESC LIMIT 2`,
      )
      .all(gameId) as { ply: number; player: Player; kind: string }[];

    const bot = botInGame(game);
    if (bot === null) {
      throw new GameError("Against a person, takebacks are offered — from the winner, when the game ends.", 409);
    }
    const removed = 2;

    // Every removed row must be an ordinary move by the expected side; setup
    // cannot be taken back. Against a person: the opponent's move. Against the
    // engine: its reply and then your own move underneath.
    if (last.length < removed) throw new GameError("Nothing to take back.");
    if (last[0].kind !== "move" || last[0].player !== -side) {
      throw new GameError("Nothing to take back.");
    }
    if (removed === 2 && (last[1].kind !== "move" || last[1].player !== side)) {
      throw new GameError("Nothing to take back.");
    }

    const cutoff = game.ply - removed;
    const before = db
      .prepare("SELECT board_after FROM moves WHERE game_id = ? AND ply = ?")
      .get(gameId, cutoff) as { board_after: string } | undefined;
    // The setup plies always exist beneath any move, so this cannot miss.
    if (!before) throw new GameError("Nothing to take back.");

    db.prepare("DELETE FROM moves WHERE game_id = ? AND ply > ?").run(gameId, cutoff);
    db.prepare(
      `UPDATE games
          SET board = ?, ply = ?, turn = ?, deadline_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      before.board_after,
      cutoff,
      // The side whose move was removed plays again: the opponent against a
      // person, yourself against the engine.
      bot === null ? -side : side,
      now() + game.move_seconds,
      now(),
      gameId,
    );

    return getGame(gameId)!;
  });
}

/**
 * Offer the loser a rewind, from a game that just ended at the goal.
 *
 * The winner's gesture for a game decided by a simple blunder: an OFFER the
 * loser accepts or declines, never something done to them — their move is
 * theirs. Only for goal endings; a resignation or timeout was the loser's own
 * decision to end things.
 */
export function offerTakeback(gameId: string, userId: string): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Game
      | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "finished" || game.result_reason !== "goal") {
      throw new GameError("A takeback is offered from a game won at the goal.");
    }
    if (botInGame(game)) throw new GameError("The engine takes no takebacks.");
    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);
    if (side !== game.result) throw new GameError("Only the winner can offer.", 403);

    db.prepare("UPDATE games SET takeback_offered = 1, updated_at = ? WHERE id = ?").run(
      now(),
      gameId,
    );
    return getGame(gameId)!;
  });
}

/**
 * Answer a takeback offer.
 *
 * Accepting rewinds to just before the loser's last move — theirs to replay,
 * with the winning sequence above it deleted — and the game is live again.
 * Declining clears the offer and the result stands.
 */
export function answerTakeback(
  gameId: string,
  userId: string,
  accept: boolean,
): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Game
      | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (!game.takeback_offered) throw new GameError("No takeback is on offer.", 404);
    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);
    if (side === game.result) throw new GameError("The offer is yours to make, not answer.", 403);

    if (!accept) {
      db.prepare(
        "UPDATE games SET takeback_offered = 0, updated_at = ? WHERE id = ?",
      ).run(now(), gameId);
      return getGame(gameId)!;
    }

    const lastOwn = db
      .prepare(
        `SELECT MAX(ply) AS ply FROM moves
          WHERE game_id = ? AND kind = 'move' AND player = ?`,
      )
      .get(gameId, side) as { ply: number | null };
    if (lastOwn.ply === null) throw new GameError("Nothing to take back.");

    const cutoff = lastOwn.ply - 1;
    const before = db
      .prepare("SELECT board_after FROM moves WHERE game_id = ? AND ply = ?")
      .get(gameId, cutoff) as { board_after: string } | undefined;
    if (!before) throw new GameError("Nothing to take back.");

    db.prepare("DELETE FROM moves WHERE game_id = ? AND ply > ?").run(gameId, cutoff);
    db.prepare(
      `UPDATE games
          SET board = ?, ply = ?, turn = ?, status = 'active',
              result = NULL, result_reason = NULL, finished_at = NULL,
              takeback_offered = 0, deadline_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(before.board_after, cutoff, side, now() + game.move_seconds, now(), gameId);

    return getGame(gameId)!;
  });
}

/**
 * Claim a win from an opponent whose clock has run out.
 *
 * Deliberately a choice, never automatic. A correspondence deadline going by
 * usually means life happened, and many players would rather wait than take a
 * game on time — so the clock expiring only ARMS this, and the game stands
 * until the waiting player decides. Active games only: a game stuck in setup
 * is walked away from with abandonGame, which records nothing against anyone.
 */
export function claimTimeout(gameId: string, userId: string): GameWithPlayers {
  return transaction(() => {
    const db = getDb();
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Game
      | undefined;
    if (!game) throw new GameError("Game not found.", 404);
    if (game.status !== "active") throw new GameError("That game is not in progress.");

    const side = sideOf(game, userId);
    if (side === null) throw new GameError("You are not a player in this game.", 403);
    if (side === game.turn) {
      throw new GameError("It is your move — the clock is yours.", 409);
    }
    if (game.deadline_at === null || game.deadline_at > now()) {
      throw new GameError("Their time has not run out.", 409);
    }

    db.prepare(
      `UPDATE games
          SET status = 'finished', result = ?, result_reason = 'timeout',
              deadline_at = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active'`,
    ).run(side, now(), now(), gameId);

    return getGame(gameId)!;
  });
}

// ---------------------------------------------------------------------------
// Leaderboard
//
// A plain win count for now. Ratings (Glicko-2) are the next step here; see
// docs/ROADMAP.md.
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  id: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
}

/** A win/loss record over some set of games. */
export interface Record_ {
  wins: number;
  losses: number;
  draws: number;
  played: number;
}

export interface PlayerStats {
  user: User;
  /**
   * The record against other people. This is *the* record — it is what the
   * leaderboard ranks and what a profile leads with.
   *
   * Games against the engine are deliberately not counted here. A bot plays a
   * fixed, published strength and will happily play a thousand games, so
   * beating one says something quite different from beating a person, and
   * mixing them makes both numbers mean less. Kept in `vsBots` instead.
   */
  wins: number;
  losses: number;
  draws: number;
  played: number;
  /** Games in progress, against anyone. */
  active: number;
  /** The record against the engine, shown separately. */
  vsBots: Record_;
  /**
   * The human record split by seat. Which side moves first is a coin toss, but
   * the seats still differ — player 1 places first, so their opponent arranges
   * with full knowledge of their row. Whether that matters in practice is
   * exactly what this split lets a player see.
   */
  asP1: Record_;
  asP2: Record_;
}

/** A player's public record. Returns null for an unknown name. */
export function playerStats(username: string): PlayerStats | null {
  const user = findUserByName(username);
  if (!user) return null;

  // The opponent in each game — whichever seat this player is not in. Joining
  // it is what lets a single pass split the record by who was on the other
  // side. LEFT JOIN because an open game has no second player yet.
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN done AND human AND won  THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN done AND human AND lost THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN done AND human AND drew THEN 1 ELSE 0 END) AS draws,
         SUM(CASE WHEN done AND human          THEN 1 ELSE 0 END) AS played,
         SUM(CASE WHEN done AND bot AND won    THEN 1 ELSE 0 END) AS bot_wins,
         SUM(CASE WHEN done AND bot AND lost   THEN 1 ELSE 0 END) AS bot_losses,
         SUM(CASE WHEN done AND bot AND drew   THEN 1 ELSE 0 END) AS bot_draws,
         SUM(CASE WHEN done AND bot            THEN 1 ELSE 0 END) AS bot_played,
         SUM(CASE WHEN done AND human AND won  AND seat1 THEN 1 ELSE 0 END) AS p1_wins,
         SUM(CASE WHEN done AND human AND lost AND seat1 THEN 1 ELSE 0 END) AS p1_losses,
         SUM(CASE WHEN done AND human AND drew AND seat1 THEN 1 ELSE 0 END) AS p1_draws,
         SUM(CASE WHEN done AND human AND seat1          THEN 1 ELSE 0 END) AS p1_played,
         SUM(CASE WHEN done AND human AND won  AND NOT seat1 THEN 1 ELSE 0 END) AS p2_wins,
         SUM(CASE WHEN done AND human AND lost AND NOT seat1 THEN 1 ELSE 0 END) AS p2_losses,
         SUM(CASE WHEN done AND human AND drew AND NOT seat1 THEN 1 ELSE 0 END) AS p2_draws,
         SUM(CASE WHEN done AND human AND NOT seat1          THEN 1 ELSE 0 END) AS p2_played,
         SUM(CASE WHEN running THEN 1 ELSE 0 END) AS active
       FROM (
         SELECT
           g.status = 'finished' AS done,
           g.status IN ('active', 'setup') AS running,
           opp.bot_strength IS NULL AS human,
           opp.bot_strength IS NOT NULL AS bot,
           ((g.player1_id = @id AND g.result = 1)
         OR (g.player2_id = @id AND g.result = -1)) AS won,
           ((g.player1_id = @id AND g.result = -1)
         OR (g.player2_id = @id AND g.result = 1)) AS lost,
           g.result = 0 AS drew,
           g.player1_id = @id AS seat1
         FROM games g
         LEFT JOIN users opp
           ON opp.id = CASE WHEN g.player1_id = @id THEN g.player2_id
                            ELSE g.player1_id END
        WHERE g.player1_id = @id OR g.player2_id = @id
       )`,
    )
    .get({ id: user.id }) as Record<string, number | null>;

  const n = (k: string) => row[k] ?? 0;

  return {
    user,
    wins: n("wins"),
    losses: n("losses"),
    draws: n("draws"),
    played: n("played"),
    active: n("active"),
    vsBots: {
      wins: n("bot_wins"),
      losses: n("bot_losses"),
      draws: n("bot_draws"),
      played: n("bot_played"),
    },
    asP1: {
      wins: n("p1_wins"),
      losses: n("p1_losses"),
      draws: n("p1_draws"),
      played: n("p1_played"),
    },
    asP2: {
      wins: n("p2_wins"),
      losses: n("p2_losses"),
      draws: n("p2_draws"),
      played: n("p2_played"),
    },
  };
}

/**
 * One player's record against one other, from `userId`'s side of the board.
 *
 * Bots included when the other party is one — the whole point of a bot
 * profile is that this number is meaningful against a fixed opponent.
 */
export function headToHead(userId: string, otherId: string): Record_ {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN (g.player1_id = @me AND g.result = 1)
                    OR (g.player2_id = @me AND g.result = -1) THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN (g.player1_id = @me AND g.result = -1)
                    OR (g.player2_id = @me AND g.result = 1) THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN g.result = 0 THEN 1 ELSE 0 END) AS draws,
         COUNT(g.id) AS played
       FROM games g
      WHERE g.status = 'finished'
        AND ((g.player1_id = @me AND g.player2_id = @them)
          OR (g.player1_id = @them AND g.player2_id = @me))`,
    )
    .get({ me: userId, them: otherId }) as Record<string, number | null>;
  return {
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    draws: row.draws ?? 0,
    played: row.played ?? 0,
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

/**
 * The human leaderboard.
 *
 * Bots are excluded, and so are **games against them**. They are real accounts
 * with real records, but ranking a calibration point against people is a
 * category error: a bot's score says what the engine was configured to do, not
 * how well it played. And a player who beat Helios-Glance forty times has not
 * out-performed one who beat a person twice — counting those together would
 * make the board a measure of persistence rather than skill.
 *
 * Bot games still appear on a player's profile, under their own heading; they
 * are simply not what the ranking is about. Bots get their own board, ordered
 * by strength rather than wins — see botLeaderboard().
 */
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
         -- The opponent, so games against the engine can be left out.
         LEFT JOIN users opp
           ON opp.id = CASE WHEN g.player1_id = u.id THEN g.player2_id
                            ELSE g.player1_id END
        WHERE u.deleted_at IS NULL
          AND u.bot_strength IS NULL
          AND opp.bot_strength IS NULL
        GROUP BY u.id, u.username
        ORDER BY wins DESC, played ASC, u.username ASC
        LIMIT ?`,
    )
    .all(limit) as LeaderboardRow[];
}

export interface BotRow extends LeaderboardRow {
  strength: number;
  description: string | null;
  /** UGI options as stored, so the UI can show the node budget. */
  options: string | null;
  engine_build: string | null;
}

/**
 * Every bot, with its record.
 *
 * A LEFT JOIN, unlike the human leaderboard's inner join: a bot that has not
 * been beaten — or played — yet must still appear in the list, because this is
 * also the menu of opponents to choose from. A board that hides the bots
 * nobody has played is useless for picking one.
 *
 * Ordered by strength ascending, so the list reads as a difficulty ladder
 * rather than a ranking.
 */
export function botLeaderboard(): BotRow[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.username,
              u.bot_strength AS strength,
              u.bot_description AS description,
              u.bot_options AS options,
              u.bot_engine_build AS engine_build,
              COALESCE(SUM(CASE WHEN (g.player1_id = u.id AND g.result = 1)
                         OR (g.player2_id = u.id AND g.result = -1) THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(SUM(CASE WHEN (g.player1_id = u.id AND g.result = -1)
                         OR (g.player2_id = u.id AND g.result = 1) THEN 1 ELSE 0 END), 0) AS losses,
              COALESCE(SUM(CASE WHEN g.result = 0 THEN 1 ELSE 0 END), 0) AS draws,
              COUNT(g.id) AS played
         FROM users u
         LEFT JOIN games g
           ON (g.player1_id = u.id OR g.player2_id = u.id) AND g.status = 'finished'
        WHERE u.deleted_at IS NULL AND u.bot_strength IS NOT NULL
        GROUP BY u.id, u.username, u.bot_strength, u.bot_description,
                 u.bot_options, u.bot_engine_build
        ORDER BY u.bot_strength ASC, u.username ASC`,
    )
    .all() as BotRow[];
}

/**
 * Create a bot account.
 *
 * Deliberately has no password: verifyPassword refuses a null hash, so a bot's
 * account cannot be signed in to at all.
 */
export interface BotSpec {
  username: string;
  /** Engine skill setting. */
  strength: number;
  /**
   * UGI options, applied verbatim before the search.
   *
   * Must include `maxNodes`: a node budget is what makes a bot play the same
   * move on every device, which is what makes its record mean anything.
   */
  options: Record<string, string | number | boolean>;
  /** Which engine build this bot plays with, e.g. "v2.0.0-wasm". */
  engineBuild: string;
  description?: string | null;
}

/**
 * Create a bot account.
 *
 * The three numbers — strength, node budget, table size — are a complete spec:
 * together they reproduce this bot's play exactly, on any device. Changing any
 * of them makes it a different opponent, which is why they are stored per bot
 * rather than chosen by whoever's browser happens to run the search.
 *
 * Deliberately has no password: verifyPassword refuses a null hash, so a bot's
 * account cannot be signed in to at all.
 */
export function createBot(spec: BotSpec): User {
  const { username, strength, options, engineBuild, description = null } = spec;
  if (!Number.isInteger(strength) || strength < 0) {
    throw new GameError("A bot's strength must be a non-negative integer.");
  }
  // A bot must be bounded by WORK, not by time.
  //
  // `maxNodes` (how much of the tree to visit) and `maxPly` (how deep to look)
  // are both reproducible: a slow device takes longer but explores the same
  // tree and returns the same move. `maxTime` is not — it would make a fast
  // machine face a stronger opponent, so a bot's record would describe its
  // opponents' hardware rather than the bot.
  const bounded = ["maxNodes", "maxPly"].some((k) => {
    const v = options[k];
    return typeof v === "number" && Number.isInteger(v) && v > 0;
  });
  if (!bounded) {
    throw new GameError(
      "A bot needs a positive integer maxNodes or maxPly option: without a " +
        "work budget its play is not reproducible across devices.",
    );
  }
  if (options.maxTime !== undefined) {
    throw new GameError(
      "A bot cannot be bounded by maxTime: a faster device would face a " +
        "stronger opponent, which makes its record meaningless.",
    );
  }
  if (!engineBuild || !engineBuild.trim()) {
    throw new GameError("A bot must record which engine build it plays with.");
  }

  const user = createUser(username);
  getDb()
    .prepare(
      `UPDATE users
          SET bot_strength = ?, bot_description = ?, bot_options = ?, bot_engine_build = ?
        WHERE id = ?`,
    )
    .run(strength, description, JSON.stringify(options), engineBuild.trim(), user.id);

  return {
    ...user,
    bot_strength: strength,
    bot_description: description,
    bot_options: options,
    bot_engine_build: engineBuild.trim(),
  };
}
