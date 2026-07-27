/**
 * Persistence for Observational Memory entries.
 *
 * Owner-scoped throughout: every read and write takes an `ownerEmail` and the
 * SQL always filters by it, so the ownable table is never read or written
 * cross-owner (per the `security` skill). Dialect-agnostic — only `getDbExec()`
 * and parameterized SQL, never raw SQLite/Postgres types or string interpolation
 * of user data.
 *
 * `ensureTable()` lazily creates the table on first use (the same belt-and-
 * suspenders pattern as `chat-threads/store.ts`), so OM works in tests and at
 * runtime even before the migration plugin is registered.
 */

import { getDbExec, isPostgres } from "../../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../../db/ddl-guard.js";
import type {
  ObservationalMemoryEntry,
  ObservationalMemoryOwner,
  ObservationalMemoryTier,
} from "./types.js";

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const client = getDbExec();
    const intType = isPostgres() ? "BIGINT" : "INTEGER";
    const createSql = `CREATE TABLE IF NOT EXISTS observational_memory (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        text TEXT NOT NULL,
        token_estimate ${intType} NOT NULL DEFAULT 0,
        source_start_index ${intType},
        source_end_index ${intType},
        source_message_count ${intType} NOT NULL DEFAULT 0,
        created_at ${intType} NOT NULL,
        updated_at ${intType} NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`;

    if (isPostgres()) {
      // PG-guard: probe information_schema / pg_indexes before issuing DDL to
      // avoid ACCESS EXCLUSIVE lock contention in fresh background-worker processes.
      await ensureTableExists("observational_memory", createSql);
      await ensureIndexExists(
        "observational_memory_thread_tier_idx",
        `CREATE INDEX IF NOT EXISTS observational_memory_thread_tier_idx
          ON observational_memory(thread_id, tier, created_at)`,
      );
      await ensureIndexExists(
        "observational_memory_thread_owner_idx",
        `CREATE INDEX IF NOT EXISTS observational_memory_thread_owner_idx
          ON observational_memory(thread_id, owner_email)`,
      );
      return;
    }

    // SQLite (local dev): no lock problem — keep the original behaviour.
    await client.execute(createSql);
    try {
      await client.execute(
        `CREATE INDEX IF NOT EXISTS observational_memory_thread_tier_idx
          ON observational_memory(thread_id, tier, created_at)`,
      );
    } catch {
      // Index already exists.
    }
    try {
      await client.execute(
        `CREATE INDEX IF NOT EXISTS observational_memory_thread_owner_idx
          ON observational_memory(thread_id, owner_email)`,
      );
    } catch {
      // Index already exists.
    }
  })().catch((err) => {
    // Reset so a transient failure (e.g. SQLITE_BUSY on HMR) can retry.
    tableReady = null;
    throw err;
  });
  return tableReady;
}

/** Reset the cached ensureTable promise — test-only seam. */
export function __resetObservationalMemoryTableCache(): void {
  tableReady = null;
}

function entryId(): string {
  return `om-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToEntry(row: Record<string, unknown>): ObservationalMemoryEntry {
  const ownerEmail =
    typeof row.owner_email === "string" && row.owner_email.trim()
      ? row.owner_email
      : null;
  if (!ownerEmail) {
    throw new Error("Observational memory row is missing owner_email.");
  }
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    tier: row.tier as ObservationalMemoryTier,
    text: typeof row.text === "string" ? row.text : "",
    tokenEstimate: Number(row.token_estimate) || 0,
    sourceStartIndex: numOrNull(row.source_start_index),
    sourceEndIndex: numOrNull(row.source_end_index),
    sourceMessageCount: Number(row.source_message_count) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    ownerEmail,
    orgId: typeof row.org_id === "string" ? row.org_id : null,
    visibility:
      (row.visibility as ObservationalMemoryEntry["visibility"]) ?? "private",
  };
}

function addOwnerScope(
  clauses: string[],
  args: unknown[],
  owner: ObservationalMemoryOwner,
): void {
  clauses.push("owner_email = ?");
  args.push(owner.ownerEmail);
  if (owner.orgId == null) {
    clauses.push("org_id IS NULL");
  } else {
    clauses.push("org_id = ?");
    args.push(owner.orgId);
  }
}

export interface InsertObservationalMemoryInput extends ObservationalMemoryOwner {
  threadId: string;
  tier: ObservationalMemoryTier;
  text: string;
  tokenEstimate: number;
  sourceStartIndex?: number | null;
  sourceEndIndex?: number | null;
  sourceMessageCount?: number;
  visibility?: "private" | "org" | "public";
}

/** Insert one OM entry, returning the persisted row. */
export async function insertObservationalMemory(
  input: InsertObservationalMemoryInput,
): Promise<ObservationalMemoryEntry> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = entryId();
  const entry: ObservationalMemoryEntry = {
    id,
    threadId: input.threadId,
    tier: input.tier,
    text: input.text,
    tokenEstimate: input.tokenEstimate,
    sourceStartIndex: input.sourceStartIndex ?? null,
    sourceEndIndex: input.sourceEndIndex ?? null,
    sourceMessageCount: input.sourceMessageCount ?? 0,
    createdAt: now,
    updatedAt: now,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    visibility: input.visibility ?? "private",
  };
  await client.execute({
    sql: `INSERT INTO observational_memory
      (id, thread_id, tier, text, token_estimate, source_start_index, source_end_index, source_message_count, created_at, updated_at, owner_email, org_id, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.id,
      entry.threadId,
      entry.tier,
      entry.text,
      entry.tokenEstimate,
      entry.sourceStartIndex,
      entry.sourceEndIndex,
      entry.sourceMessageCount,
      entry.createdAt,
      entry.updatedAt,
      entry.ownerEmail,
      entry.orgId,
      entry.visibility,
    ],
  });
  return entry;
}

export interface ListObservationalMemoryOptions extends ObservationalMemoryOwner {
  threadId: string;
  /** When set, only entries of this tier are returned. */
  tier?: ObservationalMemoryTier;
}

/**
 * List a thread's OM entries for an owner, oldest → newest. Always
 * owner-scoped; `org_id` is matched too when supplied so org-visible rows
 * don't leak across orgs.
 */
export async function listObservationalMemory(
  options: ListObservationalMemoryOptions,
): Promise<ObservationalMemoryEntry[]> {
  await ensureTable();
  const client = getDbExec();
  const clauses = ["thread_id = ?"];
  const args: unknown[] = [options.threadId];
  addOwnerScope(clauses, args, options);
  if (options.tier) {
    clauses.push("tier = ?");
    args.push(options.tier);
  }
  const result = await client.execute({
    sql: `SELECT * FROM observational_memory WHERE ${clauses.join(
      " AND ",
    )} ORDER BY created_at ASC, id ASC`,
    args,
  });
  return (result.rows as Record<string, unknown>[]).map(rowToEntry);
}

/**
 * The highest source-message index already folded into an observation for this
 * thread/owner, or -1 if none. The Observer uses this to know which messages
 * are still unobserved.
 */
export async function getObservedThroughIndex(
  options: ObservationalMemoryOwner & { threadId: string },
): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const clauses = ["thread_id = ?", "tier = 'observation'"];
  const args: unknown[] = [options.threadId];
  addOwnerScope(clauses, args, options);
  const result = await client.execute({
    sql: `SELECT MAX(source_end_index) AS max_idx
      FROM observational_memory
      WHERE ${clauses.join(" AND ")}`,
    args,
  });
  const row = (result.rows as Record<string, unknown>[])[0];
  const max = numOrNull(row?.max_idx);
  return max == null ? -1 : max;
}

/** Sum the token estimates of a thread's observation entries for an owner. */
export async function getObservationLogTokens(
  options: ObservationalMemoryOwner & { threadId: string },
): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const clauses = ["thread_id = ?", "tier = 'observation'"];
  const args: unknown[] = [options.threadId];
  addOwnerScope(clauses, args, options);
  const result = await client.execute({
    sql: `SELECT COALESCE(SUM(token_estimate), 0) AS total
      FROM observational_memory
      WHERE ${clauses.join(" AND ")}`,
    args,
  });
  const row = (result.rows as Record<string, unknown>[])[0];
  return Number(row?.total) || 0;
}
