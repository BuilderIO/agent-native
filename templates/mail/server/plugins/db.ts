import { runMigrations, intType } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('snooze', 'send_later')),
    email_id TEXT,
    payload TEXT NOT NULL,
    run_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'cancelled')),
    created_at INTEGER NOT NULL
  )`,
  },
  {
    version: 2,
    sql: `ALTER TABLE scheduled_jobs ADD COLUMN account_email TEXT`,
  },
  {
    version: 3,
    sql: `ALTER TABLE scheduled_jobs ADD COLUMN owner_email TEXT`,
  },
  {
    version: 4,
    sql: `ALTER TABLE scheduled_jobs ADD COLUMN thread_id TEXT`,
  },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    condition TEXT NOT NULL,
    actions TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS contact_frequency (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    send_count ${intType()} NOT NULL DEFAULT 0,
    receive_count ${intType()} NOT NULL DEFAULT 0,
    last_contacted_at ${intType()} NOT NULL
  )`,
  },
]);
