-- rooms.last_reaction_at marks the last time an emoji landed in the room.
-- The room row is already loaded by every poll, so a room with no reaction
-- inside the 5s display window can skip the reactions query completely - which
-- is what keeps the `unchanged` poll down to two D1 queries.
ALTER TABLE rooms ADD COLUMN last_reaction_at INTEGER NOT NULL DEFAULT 0;
