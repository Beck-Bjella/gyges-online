-- 0002_add_passwords — accounts get a password.
--
-- Nullable, but NOT because accounts might lack one: every account created
-- through the site has a password. It is nullable so that BOTS can exist —
-- the engine's accounts (see 0003) store no password, and verifyPassword
-- refuses a null hash outright, which is what makes them impossible to sign
-- in to.
--
-- There is deliberately no path that sets a password by signing in.
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- When the password was last set. Useful for "you changed your password on X",
-- and for invalidating sessions issued before a change.
ALTER TABLE users ADD COLUMN password_set_at INTEGER;
