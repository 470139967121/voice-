-- Banner carousel management
CREATE TABLE IF NOT EXISTS banners (
  id TEXT PRIMARY KEY,
  title TEXT,
  image_url TEXT NOT NULL,
  action_type TEXT DEFAULT 'NONE',
  action_value TEXT,
  start_date INTEGER,
  end_date INTEGER,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
