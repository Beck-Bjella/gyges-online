-- 0013_rename_club_to_hard — "Club" assumed the reader knows club chess.
--
-- Same shape as 0012, for the same reason: syncBots keys bots by username, so
-- renaming only in code would create a fresh account and retire this one,
-- games and badges included. Renamed in place, the id survives and everything
-- carries over. Guarded, so a fresh database — where the bot is created as
-- Hard directly — applies this as a no-op.
UPDATE users SET username = 'Hard', username_key = 'hard'
 WHERE username_key = 'club';
