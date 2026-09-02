-- 0009_add_sign_in_attempts — somewhere to count failed sign-ins.
--
-- Passwords are hashed with an argon2-family KDF, which makes each guess
-- expensive, and the session cookie is httpOnly with SameSite=Lax. What was
-- missing is the limit on how MANY guesses: nothing stopped a script trying a
-- million passwords against one account, and a slow hash only means it takes
-- longer, not that it fails.
--
-- One row per failure, counted over a window. Two scopes share the table:
--
--   user:<username_key>   guesses at one account, whether or not it exists —
--                         it must cover names that do not, or the limit
--                         itself would say which names are real
--   ip:<address>          one source spraying many accounts, which a
--                         per-account limit never sees
--
-- Successes are not recorded: this table only ever answers "how many failures
-- recently", and rows older than the window are deleted as they are written.
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  -- Unix seconds, like the other account-level timestamps.
  at    INTEGER NOT NULL
);

-- The only query: how many failures in this scope since a moment.
CREATE INDEX IF NOT EXISTS idx_sign_in_attempts ON sign_in_attempts (scope, at);
