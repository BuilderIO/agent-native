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
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS email_tracking (
    pixel_token TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    sent_at ${intType()} NOT NULL,
    opens_count ${intType()} NOT NULL DEFAULT 0,
    first_opened_at ${intType()},
    last_opened_at ${intType()},
    last_user_agent TEXT
  )`,
  },
  {
    version: 8,
    sql: `CREATE INDEX IF NOT EXISTS idx_email_tracking_message_id ON email_tracking(message_id)`,
  },
  {
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS email_link_tracking (
    click_token TEXT PRIMARY KEY,
    pixel_token TEXT NOT NULL,
    url TEXT NOT NULL,
    clicks_count ${intType()} NOT NULL DEFAULT 0,
    first_clicked_at ${intType()},
    last_clicked_at ${intType()}
  )`,
  },
  {
    version: 10,
    sql: `CREATE INDEX IF NOT EXISTS idx_email_link_tracking_pixel_token ON email_link_tracking(pixel_token)`,
  },
]);
