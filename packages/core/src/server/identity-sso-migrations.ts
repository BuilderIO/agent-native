import type { MigrationEntry } from "../db/migrations.js";

/**
 * Cross-app SSO state belongs to every app that can receive a callback. Keep
 * these tables in the framework release migration so production serverless
 * requests never need to create schema before starting a login.
 */
export const IDENTITY_SSO_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "identity-sso-flow-state-and-jti",
    sql: `
      CREATE TABLE IF NOT EXISTS identity_sso_flow_state (
        state TEXT PRIMARY KEY,
        return_path TEXT,
        app_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        authority TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        created_at INTEGER,
        expires_at INTEGER,
        consumed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS identity_sso_flow_state_expires_idx
        ON identity_sso_flow_state (expires_at);

      CREATE TABLE IF NOT EXISTS identity_sso_jti (
        jti TEXT PRIMARY KEY,
        seen_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS identity_sso_jti_seen_idx
        ON identity_sso_jti (seen_at);
    `,
  },
];
