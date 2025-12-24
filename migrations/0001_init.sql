-- Kent bot schema v0.1
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tg_id TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  is_banned INTEGER NOT NULL DEFAULT 0,
  warn_count INTEGER NOT NULL DEFAULT 0,
  ban_expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kents (
  id TEXT PRIMARY KEY,
  tg_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  games TEXT NOT NULL,
  bio TEXT NOT NULL,
  status TEXT NOT NULL,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_tg_id TEXT NOT NULL,
  kent_tg_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  from_tg_id TEXT NOT NULL,
  against_tg_id TEXT NOT NULL,
  conv_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  plan TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_kents_tg_id ON kents(tg_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_tg_id);
CREATE INDEX IF NOT EXISTS idx_conversations_kent ON conversations(kent_tg_id);
CREATE INDEX IF NOT EXISTS idx_reports_against ON reports(against_tg_id);
