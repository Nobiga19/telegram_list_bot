PRAGMA foreign_keys = ON;
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  bot_is_admin INTEGER NOT NULL DEFAULT 0 CHECK(bot_is_admin IN (0,1)),
  last_update_id INTEGER NOT NULL DEFAULT -1,
  last_announced_update_id INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK(is_primary IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT,
  deadline TEXT,
  message_id INTEGER,
  publish_state TEXT NOT NULL DEFAULT 'pending' CHECK(publish_state IN ('pending','sending','sent','failed')),
  publish_started_at INTEGER
);
CREATE UNIQUE INDEX lists_one_primary_per_group ON lists(group_id) WHERE is_primary = 1;
CREATE INDEX lists_group_created ON lists(group_id, created_at DESC);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(list_id, telegram_user_id)
);
CREATE INDEX orders_list_created ON orders(list_id, created_at, id);
