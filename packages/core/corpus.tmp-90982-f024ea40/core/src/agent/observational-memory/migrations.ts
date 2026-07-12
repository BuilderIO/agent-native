import type { MigrationEntry } from "../../db/migrations.js";

/**
 * Additive-only migrations for Observational Memory.
 *
 * These run under their OWN bookkeeping table (`_observational_memory_migrations`)
 * so the version space is independent of core/org/context-xray — see
 * `db/migrations.ts` for why each module owns its own version space.
 *
 * Strictly additive: a new table plus its hot-path indexes. Never drops,
 * renames, or destructively alters anything.
 */
export const OBSERVATIONAL_MEMORY_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS observational_memory (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      text TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      source_start_index INTEGER,
      source_end_index INTEGER,
      source_message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    // Hot path: read a thread's entries of a given tier, ordered by recency.
    version: 2,
    sql: `CREATE INDEX IF NOT EXISTS observational_memory_thread_tier_idx
      ON observational_memory(thread_id, tier, created_at)`,
  },
  {
    // Hot path: owner-scoped reads for ownable-table access checks.
    version: 3,
    sql: `CREATE INDEX IF NOT EXISTS observational_memory_thread_owner_idx
      ON observational_memory(thread_id, owner_email)`,
  },
];
