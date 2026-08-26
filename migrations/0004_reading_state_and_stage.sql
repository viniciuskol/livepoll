-- Cycle 3: the `reading` anti-cheat state, the projected stage and the
-- retroactive streak chain.
--
-- Every change below is an ALTER TABLE ADD COLUMN or a CREATE INDEX. The
-- SQLite "rebuild the table" recipe is forbidden in this schema: `answers` and
-- `reactions` declare `REFERENCES players(id) ON DELETE CASCADE`, so a
-- `DROP TABLE players` silently cascades into them and wipes every answer of
-- every existing room (this exact bug shipped in 0002 and was caught by
-- validation).

-- rooms.state now walks lobby|block_intro|reading|answering|reveal|leaderboard|ended.
-- Nothing to migrate: the old 'question' value is only ever written by code
-- that no longer exists, and a room parked in it is treated as 'answering'.

-- Accessibility / remote presenting: when 1, the prompt is also sent to the
-- phones (default off, per SPEC-UX).
ALTER TABLE rooms ADD COLUMN show_prompt_on_phone INTEGER NOT NULL DEFAULT 0;

-- The question clock now starts on the transition to `answering`, not when the
-- question opens. rooms.question_started_at stays the live value used for
-- scoring; questions.started_at keeps the per-question stamp so a host who
-- walks back and forth does not lose it.
ALTER TABLE questions ADD COLUMN started_at INTEGER;

-- Emoji avatar handed out on join; shown on the phone and next to the nickname
-- on the stage.
ALTER TABLE players ADD COLUMN avatar TEXT NOT NULL DEFAULT '';

-- Leaderboard movement arrows. prev_rank is the rank the player held at the
-- previous reveal; rank_delta is prev_rank - current_rank, snapshotted when the
-- room enters `reveal` so both the reveal screen and the leaderboard show the
-- same movement.
ALTER TABLE players ADD COLUMN prev_rank INTEGER;
ALTER TABLE players ADD COLUMN rank_delta INTEGER NOT NULL DEFAULT 0;

-- answers.ratio stores the correctness ratio the points were computed from.
-- multiple_select awards partial credit, so `correct` alone cannot rebuild the
-- points: without this, recomputing the streak chain after a retroactive grade
-- would silently round a 0.5 answer up to a full hit.
-- Legacy rows keep 0 and are read as "1 when correct" (see recomputePlayer).
ALTER TABLE answers ADD COLUMN ratio REAL NOT NULL DEFAULT 0;

-- The streak chain is rebuilt per player in question order after every grade.
CREATE INDEX IF NOT EXISTS idx_answers_player_question ON answers(player_id, question_id);
