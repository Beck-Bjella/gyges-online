-- Gygès Online — schema
--
-- Written for SQLite (local development) but deliberately kept to the subset
-- that ports to PostgreSQL with only type-name changes:
--   TEXT PRIMARY KEY      -> unchanged
--   INTEGER               -> INTEGER / BIGINT
--   strftime('%s','now')  -> EXTRACT(EPOCH FROM now())
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
  username_key  TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

  CHECK (length(username) BETWEEN 2 AND 24),
  CHECK (username_key = lower(username))
);

-- ---------------------------------------------------------------------------
-- Games
--
-- A game's authoritative content is its move list (see the moves table). The
-- board column is a derived cache, kept so game lists do not have to replay
-- every game to show a position.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  player1_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  player2_id      TEXT REFERENCES users(id) ON DELETE SET NULL,

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
  CHECK (player1_id IS NULL OR player2_id IS NULL OR player1_id <> player2_id)
);

CREATE INDEX IF NOT EXISTS games_status_idx  ON games(status);
CREATE INDEX IF NOT EXISTS games_player1_idx ON games(player1_id);
CREATE INDEX IF NOT EXISTS games_player2_idx ON games(player2_id);
CREATE INDEX IF NOT EXISTS games_deadline_idx ON games(deadline_at)
  WHERE deadline_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Moves — the source of truth
--
-- The position after any point in a game is derived by replaying these rows in
-- ply order. Never update a row here; a game's history is append-only.
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
