-- LivePoll initial schema (SPEC §7)

CREATE TABLE IF NOT EXISTS rooms (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  title          TEXT    NOT NULL DEFAULT '',
  password_hash  TEXT    NOT NULL,
  host_token     TEXT    NOT NULL,
  state          TEXT    NOT NULL DEFAULT 'lobby', -- lobby|question|reveal|leaderboard|ended
  version        INTEGER NOT NULL DEFAULT 1,
  current_question_id INTEGER,
  question_started_at INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);

CREATE TABLE IF NOT EXISTS blocks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_room ON blocks(room_id);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  block_id    INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  type        TEXT    NOT NULL,
  prompt      TEXT    NOT NULL,
  time_limit  INTEGER NOT NULL DEFAULT 20,
  points      INTEGER NOT NULL DEFAULT 1000,
  image_url   TEXT,
  explanation TEXT,
  answer_key  TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_room ON questions(room_id);
CREATE INDEX IF NOT EXISTS idx_questions_block ON questions(block_id);

CREATE TABLE IF NOT EXISTS options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  is_correct  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);

CREATE TABLE IF NOT EXISTS players (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname     TEXT    NOT NULL,
  token        TEXT    NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  streak       INTEGER NOT NULL DEFAULT 0,
  best_streak  INTEGER NOT NULL DEFAULT 0,
  joined_at    INTEGER NOT NULL,
  UNIQUE (room_id, nickname)
);
CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_players_room_score ON players(room_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_players_token ON players(token);

CREATE TABLE IF NOT EXISTS answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  choice      TEXT,   -- JSON array of option positions
  text        TEXT,
  correct     INTEGER NOT NULL DEFAULT 0,
  points      INTEGER NOT NULL DEFAULT 0,
  graded      INTEGER NOT NULL DEFAULT 1,
  elapsed_ms  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (question_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_room ON answers(room_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);

CREATE TABLE IF NOT EXISTS reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id  INTEGER REFERENCES players(id) ON DELETE CASCADE,
  emoji      TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reactions_room ON reactions(room_id, created_at);

CREATE TABLE IF NOT EXISTS open_grades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  norm_text   TEXT    NOT NULL,
  correct     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (question_id, norm_text)
);
CREATE INDEX IF NOT EXISTS idx_open_grades_question ON open_grades(question_id);
