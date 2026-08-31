-- A takeback offered on a game that just ended at the goal.
--
-- One bit, on the game: either the winner is currently offering the loser a
-- rewind or they are not. Accepting reactivates the game and clears it;
-- declining just clears it. No history of offers is kept — an offer is a
-- gesture, not a record.
ALTER TABLE games ADD COLUMN takeback_offered INTEGER NOT NULL DEFAULT 0;
