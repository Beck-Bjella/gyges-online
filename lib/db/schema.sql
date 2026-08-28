-- Gygès Online — schema
--
-- Written for SQLite (local development) and kept close to the subset that
-- ports to PostgreSQL. The migration is small but is NOT purely mechanical;
-- the known differences are:
--
--   strftime('%s','now')  -> EXTRACT(EPOCH FROM now())
--   board GLOB '[0-9]...' -> board ~ '^[0-9]{38}$'
--   INTEGER epoch columns -> keep as BIGINT, or move to timestamptz
--   TEXT status columns   -> keep as TEXT with CHECK, or a real enum
--
-- Also note: TEXT primary keys holding random ids port syntactically but are
-- not free on Postgres. Random keys scatter B-tree inserts, causing page
-- splits and write amplification, and a text key makes every index comparison
-- a collation-aware string compare. Before migrating, consider a native
-- uuid (v7, time-ordered) primary key with the short random id kept as a
-- separate public "slug" column for URLs. See docs/ROADMAP.md.
--
-- Constraints here are BOOKKEEPING ONLY. The database holds no knowledge of
-- Gygès: not what a ring is, not what a legal move is. See docs/ARCHITECTURE.md.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  -- Case-insensitive uniqueness, so "Beck" and "beck" cannot both exist.
  -- Kept in step with username by createUser(), which is the only writer.
  --
  -- Deliberately NOT enforced with `CHECK (username_key = lower(username))`:
  -- Postgres treats lower() as collation-dependent and therefore not
  -- immutable, and rejects it in a CHECK constraint. That check would block
  -- the migration.
  username_key  TEXT NOT NULL UNIQUE,
  -- Soft deletion. Accounts are never removed outright: a game is a fact, and
  -- deleting a user must not blank out their opponent's history or silently
  -- change anyone's win count. Set this instead, and clear personal fields.
  deleted_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

  CHECK (length(username) BETWEEN 2 AND 24)
);

-- ---------------------------------------------------------------------------
-- Games
--
-- The `games` row is the authority on a game's *state*: status, result, and
-- whose turn it is. The `moves` table is the authority on its *history*.
--
-- Those are deliberately separate, because not every ending is a move:
-- resignations and timeouts finish a game without adding a move row, so
-- replaying the move list alone cannot tell you how a game ended. If that ever
-- needs to be reconstructible from history alone, add a `kind` column to moves
-- ('move' | 'resign' | 'timeout' | 'draw') and record terminal events there.
--
-- `board` is a derived cache of the position, kept so the game list does not
-- replay every game on every page load. It is written only by submitMove.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  -- RESTRICT, not SET NULL: a game record must never lose track of who played
  -- it. Accounts are soft-deleted (users.deleted_at) so history stays intact.
  -- player2_id is NULL for exactly one reason - the seat is not yet filled -
  -- which is why the status CHECK below can rely on it.
  player1_id      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  player2_id      TEXT REFERENCES users(id) ON DELETE RESTRICT,

  -- 'open'     waiting for a second player
  -- 'active'   in progress
  -- 'finished' concluded
  status          TEXT NOT NULL DEFAULT 'open',

  -- 1 or -1: whose turn it is. Meaningless once finished.
  turn            INTEGER NOT NULL DEFAULT 1,

  -- 1, -1, or 0 for a draw. NULL while unfinished.
  result          INTEGER,
  -- How it ended: 'goal', 'resign', 'timeout', 'draw'.
  result_reason   TEXT,

  -- Derived cache of the current position, as a 38-character digit string.
  board           TEXT NOT NULL,
  -- Number of moves played; equals the count of rows in moves.
  ply             INTEGER NOT NULL DEFAULT 0,

  -- Correspondence time control: seconds allowed per move.
  move_seconds    INTEGER NOT NULL DEFAULT 259200, -- 72 hours
  -- When the side to move forfeits on time. NULL when not active.
  deadline_at     INTEGER,

  created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

  CHECK (status IN ('open', 'active', 'finished')),
  CHECK (turn IN (1, -1)),
  CHECK (result IS NULL OR result IN (1, -1, 0)),
  CHECK (ply >= 0),
  CHECK (move_seconds > 0),
  CHECK (length(board) = 38),
  -- A finished game has a result; an unfinished one does not.
  CHECK ((status = 'finished') = (result IS NOT NULL)),
  -- Players must be distinct when both are present.
  CHECK (player2_id IS NULL OR player1_id <> player2_id),
  -- Only an open game may be missing its second player.
  CHECK (status = 'open' OR player2_id IS NOT NULL),
  -- The board must be 38 digits, not merely 38 characters. GLOB is SQLite's
  -- pattern operator; on Postgres this becomes CHECK (board ~ '^[0-9]{38}$').
  CHECK (board GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
);

CREATE INDEX IF NOT EXISTS games_player1_idx ON games(player1_id);
CREATE INDEX IF NOT EXISTS games_player2_idx ON games(player2_id);

-- Partial indexes: much smaller than indexing every game, and they satisfy the
-- ORDER BY directly rather than making the planner sort the whole result.
CREATE INDEX IF NOT EXISTS games_open_idx ON games(created_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS games_deadline_idx ON games(deadline_at)
  WHERE status = 'active' AND deadline_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Moves — the history
--
-- The position after any point in a game is derived by replaying these rows in
-- ply order. Never update a row here; history is append-only.
--
-- (board_after is a convenience cache. replay() is cheap enough that this could
-- be dropped; it is kept because history views read it directly.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS moves (
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  -- 1-based index of this move within the game.
  ply         INTEGER NOT NULL,
  -- Which side made it: 1 or -1.
  player      INTEGER NOT NULL,
  -- Board indices joined by "|", e.g. "12|18" or "12|18|24".
  move        TEXT NOT NULL,
  -- The position this move produced, cached so history views avoid a replay.
  board_after TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (game_id, ply),
  CHECK (ply >= 1),
  CHECK (player IN (1, -1)),
  CHECK (length(board_after) = 38)
);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
-- Expired sessions are purged periodically; without this that is a full scan.
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
