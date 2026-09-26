
import { table, text, bigint } from "../db/schema.js";

export const appSecrets = table("app_secrets", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  scopeId: text("scope_id").notNull(),
  key: text("key").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  sharedEncryptedValue: text("shared_encrypted_value"),
  description: text("description"),
  urlAllowlist: text("url_allowlist"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const APP_SECRETS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS app_secrets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  shared_encrypted_value TEXT,
  description TEXT,
  url_allowlist TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope, scope_id, key)
)`;
