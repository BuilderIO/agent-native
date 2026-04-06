import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS agent_notes (
    id TEXT PRIMARY KEY,
    candidate_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    owner_email TEXT
  )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  },
  {
    version: 3,
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
    version: 4,
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
    version: 5,
    sql: `ALTER TABLE agent_notes ADD COLUMN org_id TEXT`,
  },
]);
