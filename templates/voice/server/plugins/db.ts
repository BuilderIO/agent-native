import { runMigrations } from "@agent-native/core/db";
import "../db/index.js";

const migrations = runMigrations(
  [
    // ---------------------------------------------------------------------------
    // Dictations — the core resource
    // ---------------------------------------------------------------------------
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS dictations (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      audio_path TEXT,
      app_context TEXT,
      style TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    // ---------------------------------------------------------------------------
    // Snippets — text expansion shortcuts
    // ---------------------------------------------------------------------------
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS dictation_snippets (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      trigger TEXT NOT NULL,
      expansion TEXT NOT NULL,
      is_team BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    // ---------------------------------------------------------------------------
    // Dictionary — custom vocabulary and corrections
    // ---------------------------------------------------------------------------
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS dictation_dictionary (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      correction TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    // ---------------------------------------------------------------------------
    // Styles — per-category formatting presets
    // ---------------------------------------------------------------------------
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS dictation_styles (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      preset TEXT NOT NULL DEFAULT 'casual',
      custom_prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    // ---------------------------------------------------------------------------
    // Stats — daily usage tracking
    // ---------------------------------------------------------------------------
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS dictation_stats (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      total_words INTEGER NOT NULL DEFAULT 0,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
  ],
  { table: "_voice_migrations" },
);

export default async (nitroApp: any): Promise<void> => {
  await migrations(nitroApp);
};
