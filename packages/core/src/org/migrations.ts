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
    sql: `ALTER TABLE organizations ADD COLUMN allowed_domain TEXT`,
  },
];
