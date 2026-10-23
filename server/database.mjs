import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** One connection is shared by the app's synchronous SQLite transactions. */
export function createDatabase({ filename = ':memory:' } = {}) {
  if (filename !== ':memory:')
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(filename)
  try {
    if (filename !== ':memory:') chmodSync(filename, 0o600)
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS prts_documents (
        key TEXT PRIMARY KEY CHECK (key IN ('workspace', 'preferences', 'focus')),
        data TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prts_mutations (
        key TEXT NOT NULL,
        mutation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY (key, mutation_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prts_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prts_files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        created_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        disk_key TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prts_upload_gc (
        disk_key TEXT PRIMARY KEY
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prts_imports (
        mutation_id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prts_focus_completions (
        session_id TEXT PRIMARY KEY,
        completed_at TEXT NOT NULL
      ) STRICT;
    `)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
