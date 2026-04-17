/**
 * Drizzle schema for the framework secrets registry.
 *
 * The `app_secrets` table stores API keys and service credentials that
 * templates register via `registerRequiredSecret()`. Values are always
 * stored encrypted at rest — see `storage.ts` for the crypto layer.
 *
 * Rows are scoped either to a user (by email) or a workspace / organization
 * (by orgId). OAuth-kind secrets never create a row here — they surface via
 * `@agent-native/core/oauth-tokens` instead.
 */

import { table, text, integer } from "../db/schema.js";

export const appSecrets = table("app_secrets", {
  id: text("id").primaryKey(),
  /** "user" or "workspace" — who the secret is scoped to. */
  scope: text("scope").notNull(),
  /** Session email for user-scope, orgId for workspace-scope. */
  scopeId: text("scope_id").notNull(),
  /** The registered secret key (e.g. "OPENAI_API_KEY"). */
  key: text("key").notNull(),
  /** Encrypted value — never return this through any API. */
  encryptedValue: text("encrypted_value").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Raw SQL for creating the app_secrets table. Used by the on-demand
 * `ensureTable()` path in `storage.ts` and by any template-level migration
 * that wants to create the table up-front.
 */
export const APP_SECRETS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS app_secrets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope, scope_id, key)
)`;
