import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqliteStorage = {
  db: Database.Database;
  initializeDatabase: () => void;
  getSetting: (key: string) => string | undefined;
  upsertSetting: (key: string, value: string) => void;
};

export function createSqliteStorage(databasePath: string): SqliteStorage {
  const databaseDirectory = path.dirname(databasePath);
  fs.mkdirSync(databaseDirectory, { recursive: true });

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  function initializeDatabase(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
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
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        published_at TEXT,
        thumbnail_url TEXT,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        duration TEXT,
        duration_seconds INTEGER DEFAULT 0,
        content_type TEXT DEFAULT 'long',
        outlier_score REAL DEFAULT 0,
        momentum_score REAL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS saved_outliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
        notes TEXT,
        tags_json TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workspace_id, video_id)
      );

      CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS board_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
        saved_outlier_id INTEGER REFERENCES saved_outliers(id) ON DELETE SET NULL,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS idea_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT,
        prompt_context TEXT,
        provider_id INTEGER REFERENCES llm_providers(id) ON DELETE SET NULL,
        model TEXT,
        source_video_ids_json TEXT NOT NULL DEFAULT '[]',
        result_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS thumbnail_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        character_profile_id INTEGER REFERENCES character_profiles(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        prompt TEXT NOT NULL,
        source_video_ids_json TEXT NOT NULL DEFAULT '[]',
        prompt_context TEXT,
        task_id TEXT,
        provider TEXT NOT NULL DEFAULT 'kie',
        model TEXT,
        size TEXT NOT NULL DEFAULT '16:9',
        variant_count INTEGER NOT NULL DEFAULT 1,
        result_urls_json TEXT DEFAULT '[]',
        download_urls_json TEXT DEFAULT '[]',
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS character_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        face_sheet_media_path TEXT,
        face_sheet_prompt TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS character_profile_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
        angle_label TEXT,
        media_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE,
        channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        min_outlier_score REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        alert_id INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        read_at TEXT
      );

      CREATE TABLE IF NOT EXISTS llm_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'api_key',
        api_key TEXT,
        oauth_config_json TEXT,
        model TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT,
        niche TEXT,
        primary_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS source_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        backing_list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'competitors',
        discovery_mode TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS source_set_channels (
        source_set_id INTEGER NOT NULL REFERENCES source_sets(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL DEFAULT 'competitor',
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_set_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS project_channels (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL DEFAULT 'competitor',
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS project_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_set_id INTEGER REFERENCES source_sets(id) ON DELETE SET NULL,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'outlier',
        notes TEXT,
        tags_json TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, video_id)
      );

      CREATE TABLE IF NOT EXISTS concept_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_run_id INTEGER REFERENCES workflow_runs(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        title TEXT,
        prompt_context TEXT,
        provider_id INTEGER REFERENCES llm_providers(id) ON DELETE SET NULL,
        model TEXT,
        source_reference_ids_json TEXT NOT NULL DEFAULT '[]',
        source_video_ids_json TEXT NOT NULL DEFAULT '[]',
        result_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_set_id INTEGER REFERENCES source_sets(id) ON DELETE SET NULL,
        mode TEXT NOT NULL DEFAULT 'copilot',
        status TEXT NOT NULL DEFAULT 'draft',
        current_stage TEXT NOT NULL DEFAULT 'source_discovery',
        target_niche TEXT,
        target_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS workflow_stage_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_run_id INTEGER NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS video_text_embeddings (
        video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        source_text TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS video_thumbnail_features (
        video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
        algorithm TEXT NOT NULL DEFAULT 'imghash',
        perceptual_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

    `);

    const tableHasColumn = (tableName: string, columnName: string) =>
      (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some((column) => column.name === columnName);

    if (!tableHasColumn("boards", "project_id")) {
      db.exec("ALTER TABLE boards ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;");
    }

    if (!tableHasColumn("thumbnail_generations", "project_id")) {
      db.exec("ALTER TABLE thumbnail_generations ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_videos_outlier_score ON videos(outlier_score DESC);
      CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
      CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(views DESC);
      CREATE INDEX IF NOT EXISTS idx_saved_outliers_video_id ON saved_outliers(video_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_thumbnail_generations_created_at ON thumbnail_generations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_thumbnail_generations_project_id ON thumbnail_generations(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_source_sets_project_id ON source_sets(project_id);
      CREATE INDEX IF NOT EXISTS idx_boards_project_id ON boards(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_references_project_id ON project_references(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_project_id ON workflow_runs(project_id, updated_at DESC);
    `);

    db.prepare(`
      INSERT INTO workspaces (id, name, slug)
      VALUES (1, 'Default Workspace', 'default')
      ON CONFLICT(id) DO NOTHING
    `).run();
  }

  function getSetting(key: string): string | undefined {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  function upsertSetting(key: string, value: string): void {
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  return {
    db,
    initializeDatabase,
    getSetting,
    upsertSetting,
  };
}
