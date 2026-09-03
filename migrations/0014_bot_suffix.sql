-- 0014_bot_suffix — the opponents say what they are: Rookie Bot, Hard Bot.
--
-- A name like "Casual" alone could be anybody; the suffix makes every list,
-- game page and profile self-explaining. Same shape as 0012 and 0013: renamed
-- in place because syncBots keys on username, guarded so a fresh database is
-- a no-op.
UPDATE users SET username = 'Rookie Bot', username_key = 'rookie bot'
 WHERE username_key = 'rookie';
UPDATE users SET username = 'Casual Bot', username_key = 'casual bot'
 WHERE username_key = 'casual';
UPDATE users SET username = 'Hard Bot',   username_key = 'hard bot'
 WHERE username_key = 'hard';
UPDATE users SET username = 'Expert Bot', username_key = 'expert bot'
 WHERE username_key = 'expert';
UPDATE users SET username = 'Master Bot', username_key = 'master bot'
 WHERE username_key = 'master';
