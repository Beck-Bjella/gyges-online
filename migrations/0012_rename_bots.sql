-- 0012_rename_bots — the computer opponents get names that mean something.
--
-- They were Helios-Novice through Helios-Full. "Helios" told a visitor
-- nothing, and the part that did mean something hid behind a hyphen. Now the
-- name IS the difficulty: Rookie, Casual, Club, Expert, Master.
--
-- A migration rather than just an edit to lib/bots.ts, because syncBots keys
-- bots by USERNAME: with only the code changed it would have created five new
-- accounts and retired the old ones — and with them every game on the engine
-- ladder, since a retired bot's games keep its user id. Renaming the rows in
-- place keeps the ids, so history, records and ratings carry straight over;
-- the ladder reads a bot's current name through the join, so old games rate
-- against the new name automatically.
--
-- Guarded by username_key so a fresh database — where these rows never
-- existed and syncBots creates them under the new names — applies this as a
-- no-op.
UPDATE users SET username = 'Rookie', username_key = 'rookie'
 WHERE username_key = 'helios-novice';
UPDATE users SET username = 'Casual', username_key = 'casual'
 WHERE username_key = 'helios-casual';
UPDATE users SET username = 'Club',   username_key = 'club'
 WHERE username_key = 'helios-club';
UPDATE users SET username = 'Expert', username_key = 'expert'
 WHERE username_key = 'helios-sharp';
UPDATE users SET username = 'Master', username_key = 'master'
 WHERE username_key = 'helios-full';
