CREATE TABLE IF NOT EXISTS x_profiles (
  id INTEGER PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  display_name TEXT,
  added_at REAL
);

CREATE TABLE IF NOT EXISTS x_lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at REAL
);

CREATE TABLE IF NOT EXISTS x_list_members (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES x_lists(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES x_profiles(id) ON DELETE CASCADE,
  added_at REAL,
  UNIQUE(list_id, profile_id)
);

CREATE TABLE IF NOT EXISTS x_tweets (
  id INTEGER PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  profile_id INTEGER REFERENCES x_profiles(id),
  text TEXT,
  author_handle TEXT,
  created_at REAL,
  scraped_at REAL,
  media_json TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_tweets_profile ON x_tweets(profile_id);
CREATE INDEX IF NOT EXISTS idx_tweets_created ON x_tweets(created_at DESC);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY,
  title TEXT,
  context_type TEXT,
  created_at REAL,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at REAL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  mode TEXT,
  preset TEXT DEFAULT '{}',
  status TEXT DEFAULT 'queued',
  progress REAL DEFAULT 0,
  meta TEXT DEFAULT '{}',
  created_at REAL,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE,
  title TEXT,
  channel TEXT,
  mode TEXT,
  file_path TEXT,
  phash TEXT,
  downloaded_at REAL
);

CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE,
  config TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_hist_date ON history(downloaded_at);
CREATE INDEX IF NOT EXISTS idx_hist_url ON history(url);
