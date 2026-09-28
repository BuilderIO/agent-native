import { runMigrations, type MigrationEntry } from "../db/migrations.js";

async function assertBetterAuthUserIdentityColumns(): Promise<void> {
  const { getDbExec } = await import("../db/client.js");
  const { rows } = await getDbExec().execute(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user' AND column_name IN ('id', 'email')`,
  );
  const columnNames = rows.map((row) =>
    String(row.column_name ?? row[0] ?? ""),
  );

  const missing = ["id", "email"].filter(
    (column) => !columnNames.includes(column),
  );
  if (missing.length > 0) {
    throw new Error(
      `Cannot repair the Better Auth "user" table because required identity column(s) are missing: ${missing.join(", ")}. Restore the existing user schema before deploying this migration.`,
    );
  }
}

/**
 * Better Auth encrypts persisted JWT private keys with the current auth
 * secret. If that secret is rotated, the old row remains the newest key and
 * every token-producing request fails before it can mint a replacement. Mark
 * active rows expired during the release so Better Auth rotates the signing
 * key without touching users or sessions. The JWKS endpoint keeps expired
 * keys during its grace period, so already-issued short-lived tokens remain
 * verifiable while the new key propagates.
 *
 * Also invoked at runtime by `jwks-secret-rotation.ts` when a live request
 * hits the decrypt failure — release migrations do not reach every deployed
 * database, so the release-time pass alone cannot be relied on.
 */
export async function expireJwksKeysAfterAuthSecretRotation(): Promise<void> {
  const { getDbExec } = await import("../db/client.js");
  const now = new Date().toISOString();
  const result = await getDbExec().execute({
    sql: `UPDATE "jwks" SET expires_at = ? WHERE expires_at IS NULL OR expires_at > ?`,
    args: [now, now],
  });
  if (result.rowsAffected > 0) {
    console.info(
      `[auth] Expired ${result.rowsAffected} Better Auth JWKS key(s) after auth-secret rotation; public keys remain in the verification grace period.`,
    );
  }
}

/**
 * Better Auth's framework-owned schema. This is deliberately a release
 * migration, not a fallback inside `getBetterAuth()`: request functions must
 * be able to construct the auth adapter without probing or creating tables.
 */
export const BETTER_AUTH_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "better-auth-core-tables",
    sql: {
      postgres: `
        CREATE TABLE IF NOT EXISTS "user" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          email_verified BOOLEAN NOT NULL DEFAULT FALSE,
          image TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "session" (
          id TEXT PRIMARY KEY,
          expires_at TIMESTAMPTZ NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          -- guard:allow-identity-column — Better Auth user primary key, not an email identity.
          user_id TEXT NOT NULL, -- guard:allow-identity-column — immutable Better Auth user id owned by the auth plugin
          active_organization_id TEXT
        );
        CREATE TABLE IF NOT EXISTS "account" (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          -- guard:allow-identity-column — Better Auth user primary key, not an email identity.
          user_id TEXT NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          id_token TEXT,
          access_token_expires_at TIMESTAMPTZ,
          refresh_token_expires_at TIMESTAMPTZ,
          scope TEXT,
          password TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "verification" (
          id TEXT PRIMARY KEY,
          identifier TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "organization" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          logo TEXT,
          metadata TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "member" (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          -- guard:allow-identity-column — Better Auth user primary key, not an email identity.
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "invitation" (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          expires_at TIMESTAMPTZ NOT NULL,
          inviter_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "jwks" (
          id TEXT PRIMARY KEY,
          public_key TEXT NOT NULL,
          private_key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ
        )
      `,
    },
  },
  {
    version: 2,
    name: "better-auth-repair-user-columns",
    sql: {
      postgres: `
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '';
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "image" TEXT;
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      `,
    },
    run: assertBetterAuthUserIdentityColumns,
  },
  {
    version: 3,
    name: "legacy-auth-sessions-table",
    sql: {
      postgres: `
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          email TEXT,
          created_at BIGINT NOT NULL
        )
      `,
    },
  },
  {
    version: 4,
    name: "better-auth-jwks-key-rotation-recovery",
    sql: {},
    run: expireJwksKeysAfterAuthSecretRotation,
  },
  {
    version: 5,
    name: "better-auth-add-onboarding-role",
    sql: {
      postgres: `
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboarding_role" TEXT
      `,
    },
  },
  {
    version: 5,
    name: "better-auth-user-lower-email-index",
    sql: {
      postgres:
        'CREATE INDEX IF NOT EXISTS better_auth_user_lower_email_idx ON "user" (LOWER(email))',
    },
  },
  {
    version: 6,
    name: "better-auth-enterprise-sso-scim-tables",
    sql: {
      postgres: `
        CREATE TABLE IF NOT EXISTS sso_provider (
          id TEXT PRIMARY KEY,
          issuer TEXT NOT NULL,
          oidc_config TEXT,
          saml_config TEXT,
          -- guard:allow-identity-column - immutable Better Auth provider user id
          user_id TEXT,
          provider_id TEXT NOT NULL UNIQUE,
          organization_id TEXT,
          domain TEXT NOT NULL,
          domain_verified BOOLEAN
        );
        CREATE TABLE IF NOT EXISTS scim_managed_connection (
          id TEXT PRIMARY KEY,
          creation_request_id TEXT NOT NULL UNIQUE,
          connection_id TEXT NOT NULL UNIQUE,
          provisioning_domain_id TEXT NOT NULL,
          status TEXT NOT NULL,
          revision BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          -- guard:allow-identity-column - immutable Better Auth actor id
          created_by TEXT NOT NULL,
          decommission_started_at TIMESTAMPTZ,
          decommission_started_by TEXT,
          decommissioned_at TIMESTAMPTZ,
          decommissioned_by TEXT
        );
        CREATE INDEX IF NOT EXISTS scim_managed_connection_domain_idx
          ON scim_managed_connection (provisioning_domain_id);
        CREATE TABLE IF NOT EXISTS scim_managed_credential (
          id TEXT PRIMARY KEY,
          connection_record_id TEXT NOT NULL,
          credential_id TEXT NOT NULL UNIQUE,
          token_digest TEXT NOT NULL,
          hash_version TEXT NOT NULL,
          active_slot_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          serialized_scopes TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          -- guard:allow-identity-column - immutable Better Auth actor id
          created_by TEXT NOT NULL,
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          revoked_by TEXT,
          decommissioned_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS scim_managed_credential_connection_idx
          ON scim_managed_credential (connection_record_id);
        CREATE TABLE IF NOT EXISTS scim_managed_connection_event (
          id TEXT PRIMARY KEY,
          connection_record_id TEXT NOT NULL,
          event_key TEXT NOT NULL UNIQUE,
          sequence BIGINT NOT NULL,
          type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          credential_id TEXT,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_managed_connection_event_connection_idx
          ON scim_managed_connection_event (connection_record_id);
        CREATE TABLE IF NOT EXISTS scim_connection_binding (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          connection_key TEXT NOT NULL UNIQUE,
          provisioning_domain_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          decommissioned_at TIMESTAMPTZ,
          decommission_status TEXT NOT NULL DEFAULT 'active',
          decommission_cursor_user_id TEXT,
          decommission_reconciled_user_count BIGINT NOT NULL DEFAULT 0,
          decommission_batch_count BIGINT NOT NULL DEFAULT 0,
          decommission_revision BIGINT NOT NULL DEFAULT 0,
          decommission_completed_at TIMESTAMPTZ,
          decommission_lease_id TEXT,
          decommission_lease_expires_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS scim_connection_binding_connection_idx
          ON scim_connection_binding (connection_id);
        CREATE TABLE IF NOT EXISTS scim_identity_tombstone (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          provisioning_domain_id TEXT NOT NULL,
          external_id TEXT NOT NULL,
          external_id_key TEXT NOT NULL UNIQUE,
          -- guard:allow-identity-column - immutable Better Auth user id
          user_id TEXT NOT NULL,
          profile TEXT NOT NULL,
          deleted_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_identity_tombstone_connection_idx
          ON scim_identity_tombstone (connection_id);
        CREATE INDEX IF NOT EXISTS scim_identity_tombstone_domain_idx
          ON scim_identity_tombstone (provisioning_domain_id);
        CREATE INDEX IF NOT EXISTS scim_identity_tombstone_user_idx
          ON scim_identity_tombstone (user_id);
        CREATE TABLE IF NOT EXISTS scim_subject (
          id TEXT PRIMARY KEY,
          -- guard:allow-identity-column - immutable Better Auth user id
          user_id TEXT NOT NULL UNIQUE,
          profile_source_id TEXT,
          revision BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_subject_profile_source_idx
          ON scim_subject (profile_source_id);
        CREATE TABLE IF NOT EXISTS scim_user (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          provisioning_domain_id TEXT NOT NULL,
          -- guard:allow-identity-column - immutable Better Auth user id
          user_id TEXT NOT NULL,
          connection_user_key TEXT NOT NULL UNIQUE,
          user_name TEXT NOT NULL,
          user_name_key TEXT NOT NULL UNIQUE,
          primary_email TEXT NOT NULL,
          work_email_value_index TEXT NOT NULL,
          email_value_index TEXT NOT NULL,
          display_name TEXT NOT NULL,
          formatted_name TEXT NOT NULL,
          given_name TEXT,
          family_name TEXT,
          serialized_emails TEXT NOT NULL,
          serialized_attributes TEXT,
          external_id TEXT,
          external_id_key TEXT UNIQUE,
          active BOOLEAN NOT NULL,
          order_key TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_user_connection_idx ON scim_user (connection_id);
        CREATE INDEX IF NOT EXISTS scim_user_domain_idx ON scim_user (provisioning_domain_id);
        CREATE INDEX IF NOT EXISTS scim_user_better_auth_user_idx ON scim_user (user_id);
        CREATE TABLE IF NOT EXISTS scim_projection_grant (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          provisioning_domain_id TEXT NOT NULL,
          scim_user_id TEXT NOT NULL,
          -- guard:allow-identity-column - immutable Better Auth user id
          user_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_value TEXT,
          role TEXT NOT NULL,
          grant_key TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_projection_grant_connection_idx
          ON scim_projection_grant (connection_id);
        CREATE INDEX IF NOT EXISTS scim_projection_grant_domain_idx
          ON scim_projection_grant (provisioning_domain_id);
        CREATE INDEX IF NOT EXISTS scim_projection_grant_scim_user_idx
          ON scim_projection_grant (scim_user_id);
        CREATE INDEX IF NOT EXISTS scim_projection_grant_user_idx
          ON scim_projection_grant (user_id);
        CREATE TABLE IF NOT EXISTS scim_group (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          provisioning_domain_id TEXT NOT NULL,
          revision BIGINT NOT NULL DEFAULT 0,
          display_name TEXT NOT NULL,
          display_name_key TEXT NOT NULL UNIQUE,
          external_id TEXT,
          external_id_key TEXT UNIQUE,
          order_key TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_group_connection_idx ON scim_group (connection_id);
        CREATE INDEX IF NOT EXISTS scim_group_domain_idx ON scim_group (provisioning_domain_id);
        CREATE TABLE IF NOT EXISTS scim_group_member (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          group_id TEXT NOT NULL,
          scim_user_id TEXT NOT NULL,
          membership_key TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scim_group_member_connection_idx
          ON scim_group_member (connection_id);
        CREATE INDEX IF NOT EXISTS scim_group_member_group_idx
          ON scim_group_member (group_id);
        CREATE INDEX IF NOT EXISTS scim_group_member_user_idx
          ON scim_group_member (scim_user_id)
      `,
    },
  },
  {
    version: 7,
    name: "better-auth-identity-rekey-ledger",
    sql: {
      postgres: `
        CREATE TABLE IF NOT EXISTS identity_rekeys (
          id TEXT PRIMARY KEY,
          -- guard:allow-identity-column — immutable rekey source recorded for recovery
          old_email TEXT NOT NULL,
          -- guard:allow-identity-column — immutable rekey destination recorded for recovery
          new_email TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT,
          -- guard:allow-identity-column — operator attribution, never used for access
          actor_email TEXT,
          counts_json TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          completed_at BIGINT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS identity_rekeys_old_new_idx
          ON identity_rekeys (LOWER(old_email), LOWER(new_email))
      `,
    },
  },
  {
    version: 8,
    name: "better-auth-jwks-alg-crv-columns",
    sql: {
      postgres: `
        ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "alg" TEXT;
        ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "crv" TEXT
      `,
    },
  },
  {
    version: 9,
    name: "better-auth-two-factor-tables",
    sql: {
      postgres: `
        ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enabled" BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE TABLE IF NOT EXISTS "twoFactor" (
          id TEXT PRIMARY KEY,
          secret TEXT NOT NULL,
          backup_codes TEXT NOT NULL,
          -- guard:allow-identity-column - immutable Better Auth user id owned by the auth plugin
          user_id TEXT NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT TRUE,
          failed_verification_count BIGINT NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx"
          ON "twoFactor" (secret);
        CREATE INDEX IF NOT EXISTS "twoFactor_user_id_idx"
          ON "twoFactor" (user_id)
      `,
    },
  },
];

export async function runBetterAuthMigrations(
  nitroApp: unknown,
): Promise<void> {
  await runMigrations(BETTER_AUTH_MIGRATIONS, {
    table: "_better_auth_migrations",
  })(nitroApp);
}
