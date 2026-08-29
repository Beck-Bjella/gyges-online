-- 0003_add_bots — engine accounts.
--
-- A bot is a `users` row like any other player. That is the whole design, and
-- it is why this migration is columns rather than a table: every feature
-- already built for people — profiles, game history, replay, the leaderboard —
-- works on a bot without being told about bots.
--
-- Bots have password_hash IS NULL, which is what makes them impossible to sign
-- in to: verifyPassword refuses a null hash outright, and there is no path that
-- sets a password by signing in. Their names are also taken, so nobody can
-- register as one.

-- The engine's skill setting for this bot, or NULL for a human.
--
-- What the number *means* is the engine's business; the site only orders and
-- displays it. Nullable, and NULL for every existing row: humans are the
-- default, and this migration must not touch the accounts that already exist.
ALTER TABLE users ADD COLUMN bot_strength INTEGER;

-- A short human-readable description of how this bot plays.
ALTER TABLE users ADD COLUMN bot_description TEXT;

-- ---------------------------------------------------------------------------
-- Reproducibility
--
-- The engine runs in the player's browser, so the same bot would otherwise
-- play differently depending on whose device it ran on. That would make a
-- bot's win/loss record a fact about its opponents' hardware rather than about
-- the bot, which is worth nothing on a leaderboard.
--
-- The fix is to bound the search by WORK, not by time. A node budget produces
-- the same search — and therefore the same move — on every device; a phone
-- simply takes longer in wall-clock than a desktop. Time limits would do the
-- opposite, making a fast machine play a stronger opponent.
--
-- The transposition table matters for the same reason: two searches visiting
-- the same number of nodes can still diverge if their tables differ in size,
-- because eviction changes move ordering. The browser build fixes its table at
-- one small size at compile time, so it is NOT a per-bot setting — which is
-- why there is no column for it. What is recorded instead is the engine build,
-- since that is what actually determines the table size and everything else
-- about how the search behaves.
--
-- A consequence worth stating: an interrupted search is DISCARDED, not resumed.
-- If the player closes the tab, the next page load starts the search again from
-- zero. Resuming would mean continuing with a partly-filled table, which is a
-- different search and could produce a different move — the very thing the node
-- budget exists to prevent. Nothing partial is stored, which is also why there
-- is no state here beyond the bot's own definition.
-- ---------------------------------------------------------------------------

-- The engine settings this bot plays with, as JSON: {"maxNodes": 200000, ...}.
--
-- Deliberately opaque to the site. These are UGI `setoption` names and values,
-- applied verbatim before the search, so adding an engine option — the strength
-- dial, a new limit, anything in a later release — needs no migration and no
-- change here. The site stores them, shows them, and passes them on.
--
-- What the site DOES rely on is `maxNodes` being present, because a node budget
-- is what makes play reproducible across devices (see above). Everything else
-- is the engine's business.
ALTER TABLE users ADD COLUMN bot_options TEXT;

-- Which engine build this bot's rating and games belong to.
--
-- The browser build pins its transposition table size, its evaluation network
-- and its search behaviour at compile time. A new build can therefore play a
-- different move for the same strength and node budget — the bot is only
-- reproducible *within* a build.
--
-- Recording it means a future engine release does not silently invalidate the
-- record of games played against the old one. When the build changes, the
-- honest options are to keep the old games attributed to the old build, or to
-- retire that bot and add a new one; both need this column to be possible.
ALTER TABLE users ADD COLUMN bot_engine_build TEXT;

-- The bot list and the human leaderboard both filter on this column, and both
-- run on every page load of their respective pages. Partial, because the vast
-- majority of rows are humans and indexing them here would be dead weight.
CREATE INDEX IF NOT EXISTS users_bot_idx ON users(bot_strength)
  WHERE bot_strength IS NOT NULL;
