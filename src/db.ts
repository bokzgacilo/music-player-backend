import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { sqliteNow } from "./utils/time.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration INTEGER,
      file_path TEXT NOT NULL,
      thumbnail_path TEXT,
      source_url TEXT NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      downloaded_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_by_client_id INTEGER,
      created_by_username TEXT,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      updated_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      FOREIGN KEY (created_by_client_id) REFERENCES client_users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      UNIQUE(playlist_id, song_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS download_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','downloading','processing','completed','failed')),
      progress REAL NOT NULL DEFAULT 0,
      error_message TEXT,
      requested_by_client_id INTEGER,
      requested_by_username TEXT,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      updated_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      FOREIGN KEY (requested_by_client_id) REFERENCES client_users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS client_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      avatar_path TEXT NOT NULL DEFAULT '/avatars/lion.png',
      user_agent TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      updated_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      last_seen_at TEXT NOT NULL DEFAULT (${sqliteNow})
    );

    CREATE TABLE IF NOT EXISTS client_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_agent TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      last_seen_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      FOREIGN KEY (user_id) REFERENCES client_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow})
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      last_seen_at TEXT NOT NULL DEFAULT (${sqliteNow}),
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_client_sessions_user_id ON client_sessions(user_id);
  `);
  migrateSongsTable();
  migrateDownloadJobsTable();
  migratePlaylistsTable();
  migrateClientUsersTable();
  seedAdminUser();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_songs_deleted ON songs(deleted)").run();
}

function migrateSongsTable() {
  const columns = db.prepare("PRAGMA table_info(songs)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("deleted")) {
    db.prepare("ALTER TABLE songs ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0").run();
  }

  if (!columnNames.has("deleted_at")) {
    db.prepare("ALTER TABLE songs ADD COLUMN deleted_at TEXT").run();
  }

  if (!columnNames.has("downloaded_by_client_id")) {
    db.prepare("ALTER TABLE songs ADD COLUMN downloaded_by_client_id INTEGER REFERENCES client_users(id) ON DELETE SET NULL").run();
  }

  if (!columnNames.has("downloaded_by_username")) {
    db.prepare("ALTER TABLE songs ADD COLUMN downloaded_by_username TEXT").run();
  }
}

function migrateDownloadJobsTable() {
  const columns = db.prepare("PRAGMA table_info(download_jobs)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("requested_by_client_id")) {
    db.prepare("ALTER TABLE download_jobs ADD COLUMN requested_by_client_id INTEGER REFERENCES client_users(id) ON DELETE SET NULL").run();
  }

  if (!columnNames.has("requested_by_username")) {
    db.prepare("ALTER TABLE download_jobs ADD COLUMN requested_by_username TEXT").run();
  }
}

function migratePlaylistsTable() {
  const columns = db.prepare("PRAGMA table_info(playlists)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("created_by_client_id")) {
    db.prepare("ALTER TABLE playlists ADD COLUMN created_by_client_id INTEGER REFERENCES client_users(id) ON DELETE SET NULL").run();
  }

  if (!columnNames.has("created_by_username")) {
    db.prepare("ALTER TABLE playlists ADD COLUMN created_by_username TEXT").run();
  }

  if (!columnNames.has("is_shared")) {
    db.prepare("ALTER TABLE playlists ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0").run();
  }
}

function migrateClientUsersTable() {
  const columns = db.prepare("PRAGMA table_info(client_users)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("avatar_path")) {
    db.prepare("ALTER TABLE client_users ADD COLUMN avatar_path TEXT NOT NULL DEFAULT '/avatars/lion.png'").run();
  }
}

function seedAdminUser() {
  db.prepare(`
    INSERT INTO admin_users (username, password)
    VALUES ('bokzgacilo', 'arieljericko')
    ON CONFLICT(username) DO UPDATE SET password = excluded.password
  `).run();
}
