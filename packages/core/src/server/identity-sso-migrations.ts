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
        created_at BIGINT,
        expires_at BIGINT,
        consumed_at BIGINT
      );

      CREATE INDEX IF NOT EXISTS identity_sso_flow_state_expires_idx
        ON identity_sso_flow_state (expires_at);

      CREATE TABLE IF NOT EXISTS identity_sso_jti (
        jti TEXT PRIMARY KEY,
        seen_at BIGINT
      );

      CREATE INDEX IF NOT EXISTS identity_sso_jti_seen_idx
        ON identity_sso_jti (seen_at);
    `,
  },
  {
    // Widening only. `created_at`/`expires_at`/`consumed_at`/`seen_at` store
    // JS `Date.now()` millisecond epochs (13 digits) but v1 declared them
    // `INTEGER` — Postgres int4, max 2,147,483,647 — so every SSO flow-state
    // insert overflows with `value "<ms epoch>" is out of range for type
    // integer`. This is the framework release migration (see module doc), so
    // it's the one that actually creates these tables in production.
    version: 2,
    name: "identity-sso-timestamps-bigint",
    sql: `
      ALTER TABLE identity_sso_flow_state ALTER COLUMN created_at TYPE BIGINT;
      ALTER TABLE identity_sso_flow_state ALTER COLUMN expires_at TYPE BIGINT;
      ALTER TABLE identity_sso_flow_state ALTER COLUMN consumed_at TYPE BIGINT;
      ALTER TABLE identity_sso_jti ALTER COLUMN seen_at TYPE BIGINT;
    `,
  },
];
