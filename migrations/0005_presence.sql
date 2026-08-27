-- Presence.
--
-- A player row used to live forever, so a phone whose browser was closed still
-- held its nickname and still counted as present: the roster showed a ghost,
-- `answerCount / playerCount` could never complete, and the person coming back
-- was told NICKNAME_TAKEN by their own abandoned session.
--
-- `last_seen` is stamped by the state poll (throttled, see db.js HEARTBEAT_MS),
-- which is enough to tell a live phone from a closed one and lets a returning
-- player reclaim their own name together with the score already on it.
ALTER TABLE players ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;

-- Existing rows have never polled under the new column; treat the moment they
-- joined as their last sign of life rather than 1970, which would report every
-- player of a running room as gone.
UPDATE players SET last_seen = joined_at WHERE last_seen = 0;

CREATE INDEX IF NOT EXISTS idx_players_room_seen ON players(room_id, last_seen);
