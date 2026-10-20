import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS qr_history (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  /* guard:allow-raw-color — persisted QR output default must remain black. */
  fg_color TEXT NOT NULL DEFAULT '#000000',
  /* guard:allow-raw-color — persisted QR output default must remain white. */
  bg_color TEXT NOT NULL DEFAULT '#ffffff',
  format TEXT NOT NULL DEFAULT 'png',
  size INTEGER NOT NULL DEFAULT 256,
  margin INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
    },
    {
      version: 2,
      sql: `CREATE INDEX IF NOT EXISTS qr_history_owner_created_idx ON qr_history(owner_email, created_at DESC)`,
    },
  ],
  { table: "qr_migrations" },
);
