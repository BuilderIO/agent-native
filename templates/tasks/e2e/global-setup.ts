import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const DB_PATH = resolve(process.cwd(), "data/e2e-playwright.db");

export default async function globalSetup() {
  for (const file of [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`]) {
    rmSync(file, { force: true });
  }

  mkdirSync(dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      promoted_to_task INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_owner_done_updated
      ON tasks (owner_email, done, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_owner_sort
      ON tasks (owner_email, sort_order);
    CREATE INDEX IF NOT EXISTS idx_tasks_owner_promoted_sort
      ON tasks (owner_email, promoted_to_task, sort_order);
    INSERT OR IGNORE INTO tasks_migrations VALUES (1);
    INSERT OR IGNORE INTO tasks_migrations VALUES (2);
    INSERT OR IGNORE INTO tasks_migrations VALUES (3);
    INSERT OR IGNORE INTO tasks_migrations VALUES (4);
    INSERT OR IGNORE INTO tasks_migrations VALUES (5);
    INSERT OR IGNORE INTO tasks_migrations VALUES (6);
  `);
  db.close();
}
