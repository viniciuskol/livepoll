-- Cycle 2 fixes.
--
-- 1) answers.streak_before: the player's streak *at the moment the answer was
--    submitted*. Manual open-text grading needs this to recompute points
--    deterministically; reading players.streak at grading time is wrong because
--    later questions have already mutated it (and made grading non-idempotent).
-- 2) players.nickname uniqueness must be case-insensitive so the DB constraint
--    matches the case-insensitive pre-check in the JS layer.
ALTER TABLE answers ADD COLUMN streak_before INTEGER NOT NULL DEFAULT 0;

-- Case-insensitive uniqueness is added as a UNIQUE INDEX, deliberately NOT by
-- rebuilding the table. `answers` and `reactions` declare
-- `REFERENCES players(id) ON DELETE CASCADE`, so the rebuild recipe
-- (CREATE players_nocase / copy / DROP TABLE players / RENAME) makes SQLite
-- cascade the implicit DELETE of `DROP TABLE players` into those children:
-- every answer and every reaction of every existing room is silently deleted
-- when foreign keys are enforced (D1 enforces them; node:sqlite in the unit
-- test harness does not, which is why the destruction was invisible to
-- `npm test`). An index reaches the same constraint with no data movement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nickname_nocase
  ON players (room_id, nickname COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_players_room_score ON players(room_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_players_token ON players(token);

-- Answers are looked up per player during grading recomputation.
CREATE INDEX IF NOT EXISTS idx_answers_player ON answers(player_id);
