/**
 * Migration definitions for the org module. Versions are namespaced into a high
 * range (1000+) so they don't collide with template-owned migrations sharing
 * the same `_migrations` table.
 */
export const ORG_MIGRATIONS = [
  {
    version: 1001,
    sql: `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  },
  {
    version: 1002,
    sql: `CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      UNIQUE(org_id, email)
    )`,
  },
  {
    version: 1003,
    sql: `CREATE TABLE IF NOT EXISTS org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL
    )`,
  },
  {
    version: 1004,
    sql: `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allowed_domain TEXT`,
  },
  {
    version: 1005,
    sql: `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS a2a_secret TEXT`,
  },
  {
    version: 1006,
    sql: `ALTER TABLE org_invitations ADD COLUMN IF NOT EXISTS role TEXT`,
  },
  {
    // Every authenticated request calls `getOrgContext` which queries
    // `WHERE LOWER(m.email) = ?`. Without a supporting index this is a
    // full table scan on every request. A LOWER(email) expression index
    // lets the planner use an index seek instead.
    version: 1007,
    sql: `CREATE INDEX IF NOT EXISTS org_members_lower_email_idx ON org_members (LOWER(email))`,
  },
  {
    // Domain join and org resolution query `LOWER(allowed_domain)`.
    // Keep that opt-in lookup indexed before it appears on any request path.
    version: 1008,
    sql: `CREATE INDEX IF NOT EXISTS organizations_lower_allowed_domain_idx ON organizations (LOWER(allowed_domain))`,
  },
  {
    // De-dup pass ahead of the unique index below. `org_members` has always
    // had a `UNIQUE(org_id, email)` constraint (see v1002), but that's an
    // exact-string match — callers that insert a session's raw-case email
    // (e.g. handlers.ts's acceptInvitationHandler) can still create a
    // second row for the same person under a different case, and every
    // membership *read* in this module already matches case-insensitively
    // via `LOWER(email)`. This keeps exactly one row per (org_id,
    // LOWER(email)) — the row with the oldest `joined_at` (ties broken by
    // `id` for determinism) — by deleting any row for which a strictly
    // "older" row exists in the same group. Portable across SQLite and
    // Postgres (plain correlated EXISTS subquery, no window functions).
    // Must run before the unique index below or that CREATE would fail on
    // any database that already has case-variant duplicates.
    version: 1009,
    name: "org-members-dedupe-lower-email",
    sql: `DELETE FROM org_members
      WHERE EXISTS (
        SELECT 1 FROM org_members older
        WHERE older.org_id = org_members.org_id
          AND LOWER(older.email) = LOWER(org_members.email)
          AND (
            older.joined_at < org_members.joined_at
            OR (older.joined_at = org_members.joined_at AND older.id < org_members.id)
          )
      )`,
  },
  {
    // Closes the TOCTOU window in `acceptPendingInvitationsForEmail`
    // (org/accept-pending.ts): a SELECT-then-INSERT check with no unique
    // constraint standing behind the case-insensitive comparison every
    // reader uses. Without this, two concurrent acceptances (e.g. a
    // retried signup hook) can both pass the SELECT and both INSERT,
    // producing duplicate membership rows. This expression index makes
    // (org_id, LOWER(email)) unique at the database level so an
    // `ON CONFLICT` insert (or a raw duplicate insert) is rejected
    // instead of silently creating a second row.
    version: 1010,
    name: "org-members-unique-lower-email-idx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_lower_email_uidx ON org_members (org_id, LOWER(email))`,
  },
];
