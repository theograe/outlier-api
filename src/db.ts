import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

const databaseDirectory = path.dirname(config.databasePath);
fs.mkdirSync(databaseDirectory, { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT,
      subscriber_count INTEGER,
      thumbnail_url TEXT,
      uploads_playlist_id TEXT,
      median_views INTEGER DEFAULT 0,
      last_scanned_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS list_channels (
      list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE,
      channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (list_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      published_at TEXT,
      thumbnail_url TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      duration TEXT,
      outlier_score REAL DEFAULT 0,
      view_velocity REAL DEFAULT 0,
      engagement_ratio REAL DEFAULT 0,
      scanned_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      scope_list_id INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      progress_current INTEGER DEFAULT 0,
      progress_total INTEGER DEFAULT 0,
      message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_videos_outlier_score ON videos(outlier_score DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(views DESC);
  `);

  upsertSetting("scan_schedule", config.scanSchedule);
  upsertSetting("default_outlier_threshold", String(config.defaultOutlierThreshold));
}

export function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function upsertSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
