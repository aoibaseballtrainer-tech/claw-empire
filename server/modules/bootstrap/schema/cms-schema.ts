import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "exec"> & { prepare?: (...args: unknown[]) => unknown };

export function applyCmsSchema(db: DbLike): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS cms_sections (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL DEFAULT 'home',
  section_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  subtitle TEXT,
  body TEXT,
  image_url TEXT,
  metadata_json TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS cms_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  cover_image_url TEXT,
  author_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS cms_images (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS cms_site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_post_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  referer TEXT,
  viewed_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS cms_blog_autogen_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT,
  topic_category TEXT,
  keywords_json TEXT,
  char_count INTEGER,
  model TEXT,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  generation_time_ms INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE INDEX IF NOT EXISTS idx_cms_sections_page ON cms_sections(page_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_cms_posts_status ON cms_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_posts_slug ON cms_posts(slug);
CREATE INDEX IF NOT EXISTS idx_post_views_post ON cms_post_views(post_id);
CREATE INDEX IF NOT EXISTS idx_post_views_date ON cms_post_views(viewed_at);
`);

  // Migration: add view_count column if missing
  try {
    db.exec("ALTER TABLE cms_posts ADD COLUMN view_count INTEGER DEFAULT 0");
  } catch {
    // column already exists
  }
}
