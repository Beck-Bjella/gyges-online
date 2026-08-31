-- Challenges and friends.

-- A game aimed at one person. NULL is an ordinary open game anyone may join;
-- set, only that player may take the second seat. A challenge is not its own
-- kind of thing — it is an open game with a reservation, so every existing
-- rule about open games applies to it unchanged.
ALTER TABLE games ADD COLUMN invited_id TEXT REFERENCES users(id);

-- One row per relationship, held by whoever asked. 'pending' is a request the
-- addressee has not answered; declining deletes the row rather than recording
-- a refusal, so asking again later is possible and no list of rejections
-- accumulates anywhere.
CREATE TABLE IF NOT EXISTS friends (
  requester_id TEXT NOT NULL REFERENCES users(id),
  addressee_id TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
