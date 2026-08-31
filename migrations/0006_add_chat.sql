-- Chat, in two scopes with one shape.
--
-- A message either belongs to a game — private to its two players — or to no
-- game, which is the global lobby chat. One table means one set of rules for
-- posting, fetching and display; the scope column is the only difference.
--
-- Messages are immutable and never deleted with their author: showing who
-- said what is the entire point, and a conversation with holes in it reads
-- worse than one with a closed account's name in it.
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL is the lobby.
  game_id    TEXT REFERENCES games(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  -- Unix milliseconds, like moves.created_at.
  created_at INTEGER NOT NULL
);

-- The one query that matters: new messages in a scope, in order.
CREATE INDEX IF NOT EXISTS idx_chat_scope ON chat_messages (game_id, id);
