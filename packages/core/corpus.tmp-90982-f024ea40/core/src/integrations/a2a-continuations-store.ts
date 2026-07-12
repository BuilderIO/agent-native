import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import {
  ensureTableExists,
  ensureColumnExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";
import { isDuplicateColumnError } from "../db/migrations.js";
import type { IncomingMessage, PlatformRunProgressRef } from "./types.js";

let _initPromise: Promise<void> | undefined;
const PROCESSING_STUCK_AFTER_MS = 5 * 60 * 1000;
const PROCESSING_NEXT_CHECK_STALE_AFTER_MS = 60 * 1000;

// Build the CREATE SQL lazily (not at module scope) so intType() runs at
// RUNTIME, not import time — a module-scope call breaks any consumer whose
// db/client mock doesn't stub intType (e.g. db-admin specs).
function buildCreateSql(): string {
  return `
  CREATE TABLE IF NOT EXISTS integration_a2a_continuations (
    id TEXT PRIMARY KEY,
    integration_task_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    external_thread_id TEXT NOT NULL,
    incoming_payload TEXT NOT NULL,
    placeholder_ref TEXT,
    progress_ref TEXT,
    progress_ref_claimed ${intType()} NOT NULL DEFAULT 0,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    agent_name TEXT NOT NULL,
    agent_url TEXT NOT NULL,
    dedupe_key TEXT,
    a2a_task_id TEXT NOT NULL,
    a2a_auth_token TEXT,
    status TEXT NOT NULL,
    attempts ${intType()} NOT NULL DEFAULT 0,
    next_check_at ${intType()} NOT NULL,
    error_message TEXT,
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL,
    completed_at ${intType()}
  )
`;
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = buildCreateSql();
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("integration_a2a_continuations", createSql);
        await ensureIndexExists(
          "idx_a2a_continuations_status_next",
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_status_next ON integration_a2a_continuations(status, next_check_at)`,
        );
        await ensureIndexExists(
          "idx_a2a_continuations_integration_task",
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_integration_task ON integration_a2a_continuations(integration_task_id)`,
        );
        await ensureIndexExists(
          "idx_a2a_continuations_remote_task",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_remote_task ON integration_a2a_continuations(integration_task_id, agent_url, a2a_task_id)`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "a2a_auth_token",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS a2a_auth_token TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "dedupe_key",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "progress_ref",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS progress_ref TEXT`,
        );
        await ensureColumnExists(
          "integration_a2a_continuations",
          "progress_ref_claimed",
          `ALTER TABLE integration_a2a_continuations ADD COLUMN IF NOT EXISTS progress_ref_claimed ${intType()} NOT NULL DEFAULT 0`,
        );
        await backfillProgressRefOwners(client);
        await ensureIndexExists(
          "idx_a2a_continuations_dedupe_key",
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_dedupe_key ON integration_a2a_continuations(integration_task_id, agent_url, dedupe_key)`,
        );
        await ensureIndexExists(
          "idx_a2a_continuations_one_progress_owner",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_one_progress_owner ON integration_a2a_continuations(integration_task_id) WHERE progress_ref_claimed = 1`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await retryOnDdlRace(() => client.execute(createSql));
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_status_next ON integration_a2a_continuations(status, next_check_at)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_integration_task ON integration_a2a_continuations(integration_task_id)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_remote_task ON integration_a2a_continuations(integration_task_id, agent_url, a2a_task_id)`,
        ),
      );
      await addColumnIfMissing("a2a_auth_token", "TEXT");
      await addColumnIfMissing("dedupe_key", "TEXT");
      await addColumnIfMissing("progress_ref", "TEXT");
      await addColumnIfMissing(
        "progress_ref_claimed",
        `${intType()} NOT NULL DEFAULT 0`,
      );
      await backfillProgressRefOwners(client);
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_a2a_continuations_dedupe_key ON integration_a2a_continuations(integration_task_id, agent_url, dedupe_key)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_a2a_continuations_one_progress_owner ON integration_a2a_continuations(integration_task_id) WHERE progress_ref_claimed = 1`,
        ),
      );
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

async function addColumnIfMissing(name: string, definition: string) {
  try {
    await retryOnDdlRace(() =>
      getDbExec().execute(
        `ALTER TABLE integration_a2a_continuations ADD COLUMN ${name} ${definition}`,
      ),
    );
  } catch (err) {
    if (isDuplicateColumnError(err)) return;
    throw err;
  }
}

async function backfillProgressRefOwners(
  client: ReturnType<typeof getDbExec>,
): Promise<void> {
  await client.execute(`
    UPDATE integration_a2a_continuations AS candidate
    SET progress_ref_claimed = 1
    WHERE candidate.progress_ref IS NOT NULL
      AND candidate.status NOT IN ('completed', 'failed')
      AND candidate.progress_ref_claimed = 0
      AND NOT EXISTS (
        SELECT 1
        FROM integration_a2a_continuations AS owner
        WHERE owner.integration_task_id = candidate.integration_task_id
          AND owner.progress_ref_claimed = 1
      )
      AND candidate.id = (
        SELECT selected.id
        FROM integration_a2a_continuations AS selected
        WHERE selected.integration_task_id = candidate.integration_task_id
          AND selected.progress_ref IS NOT NULL
          AND selected.status NOT IN ('completed', 'failed')
        ORDER BY selected.created_at ASC, selected.id ASC
        LIMIT 1
      )
  `);
}

export type A2AContinuationStatus =
  | "pending"
  | "processing"
  | "delivering"
  | "completed"
  | "failed";

export interface A2AContinuation {
  id: string;
  integrationTaskId: string;
  platform: string;
  externalThreadId: string;
  incoming: IncomingMessage;
  placeholderRef: string | null;
  progressRef: PlatformRunProgressRef | null;
  progressRefClaimed: boolean;
  ownerEmail: string;
  orgId: string | null;
  agentName: string;
  agentUrl: string;
  dedupeKey: string | null;
  a2aTaskId: string;
  a2aAuthToken: string | null;
  status: A2AContinuationStatus;
  attempts: number;
  nextCheckAt: number;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

const MAX_PROGRESS_REF_KIND_CHARS = 128;
const MAX_PROGRESS_REF_STREAM_TS_CHARS = 256;

/**
 * Keep only the tiny, adapter-owned continuation reference. Invalid rows are
 * treated as unavailable rather than throwing during a retry sweep.
 */
function parseProgressRef(value: unknown): PlatformRunProgressRef | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const { kind, streamTs } = parsed as Record<string, unknown>;
    if (
      typeof kind !== "string" ||
      typeof streamTs !== "string" ||
      kind.length === 0 ||
      streamTs.length === 0 ||
      kind.length > MAX_PROGRESS_REF_KIND_CHARS ||
      streamTs.length > MAX_PROGRESS_REF_STREAM_TS_CHARS
    ) {
      return null;
    }
    return { kind, streamTs };
  } catch {
    return null;
  }
}

function serializeProgressRef(value: unknown): string | null {
  const parsed = parseProgressRef(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return parsed ? JSON.stringify(parsed) : null;
}

function rowToContinuation(row: Record<string, unknown>): A2AContinuation {
  return {
    id: row.id as string,
    integrationTaskId: row.integration_task_id as string,
    platform: row.platform as string,
    externalThreadId: row.external_thread_id as string,
    incoming: JSON.parse(row.incoming_payload as string) as IncomingMessage,
    placeholderRef: (row.placeholder_ref as string | null) ?? null,
    progressRef: parseProgressRef(row.progress_ref),
    progressRefClaimed: Number(row.progress_ref_claimed ?? 0) === 1,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    agentName: row.agent_name as string,
    agentUrl: row.agent_url as string,
    dedupeKey: (row.dedupe_key as string | null) ?? null,
    a2aTaskId: row.a2a_task_id as string,
    a2aAuthToken: (row.a2a_auth_token as string | null) ?? null,
    status: row.status as A2AContinuationStatus,
    attempts: Number(row.attempts ?? 0),
    nextCheckAt: Number(row.next_check_at ?? 0),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    completedAt:
      row.completed_at == null ? null : Number(row.completed_at as number),
  };
}

export async function insertA2AContinuation(input: {
  integrationTaskId: string;
  platform: string;
  externalThreadId: string;
  incoming: IncomingMessage;
  placeholderRef?: string | null;
  progressRef?: PlatformRunProgressRef | null;
  ownerEmail: string;
  orgId?: string | null;
  agentName: string;
  agentUrl: string;
  dedupeKey?: string | null;
  a2aTaskId: string;
  a2aAuthToken?: string | null;
}): Promise<A2AContinuation> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = `a2a-cont-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(input.incoming);
  const progressRef = serializeProgressRef(input.progressRef);

  try {
    await client.execute({
      sql: `INSERT INTO integration_a2a_continuations
        (id, integration_task_id, platform, external_thread_id, incoming_payload,
         placeholder_ref, progress_ref, progress_ref_claimed, owner_email, org_id, agent_name, agent_url, dedupe_key, a2a_task_id, a2a_auth_token,
         status, attempts, next_check_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.integrationTaskId,
        input.platform,
        input.externalThreadId,
        payload,
        input.placeholderRef ?? null,
        null,
        0,
        input.ownerEmail,
        input.orgId ?? null,
        input.agentName,
        input.agentUrl,
        input.dedupeKey ?? null,
        input.a2aTaskId,
        input.a2aAuthToken ?? null,
        "pending",
        0,
        now,
        now,
        now,
      ],
    });
  } catch (err: any) {
    if (!isDuplicateContinuationError(err)) throw err;
    const existing = await findA2AContinuation(
      input.integrationTaskId,
      input.agentUrl,
      input.a2aTaskId,
    );
    if (existing) {
      // A retry can reach this row after the original invocation created it
      // without a resumable progress surface (or with one that has gone
      // stale). Keep the most recent valid adapter reference for active work,
      // but never resurrect short-lived delivery state after a terminal row
      // has deliberately scrubbed it.
      if (
        progressRef &&
        existing.status !== "completed" &&
        existing.status !== "failed"
      ) {
        if (existing.progressRefClaimed) {
          if (JSON.stringify(existing.progressRef) !== progressRef) {
            await client.execute({
              sql: `UPDATE integration_a2a_continuations
                    SET progress_ref = ?, updated_at = ?
                    WHERE id = ? AND status NOT IN ('completed', 'failed')
                      AND progress_ref_claimed = 1
                      AND (progress_ref IS NULL OR progress_ref <> ?)`,
              args: [progressRef, now, existing.id, progressRef],
            });
          }
        } else {
          await claimA2AContinuationProgressRef(existing.id, progressRef);
        }
        return (await getA2AContinuation(existing.id)) ?? existing;
      }
      return existing;
    }
    throw err;
  }

  if (progressRef) {
    await claimA2AContinuationProgressRef(id, progressRef);
  }
  return (await getA2AContinuation(id))!;
}

/**
 * A native platform stream has one terminal completion. Claim it for a single
 * downstream continuation, and retain the ownership marker after terminal
 * cleanup scrubs the short-lived stream reference. The partial unique index
 * makes concurrent downstream inserts safe across processes.
 */
async function claimA2AContinuationProgressRef(
  id: string,
  progressRef: string,
): Promise<void> {
  try {
    await getDbExec().execute({
      sql: `UPDATE integration_a2a_continuations
            SET progress_ref = ?, progress_ref_claimed = 1
            WHERE id = ? AND progress_ref_claimed = 0`,
      args: [progressRef, id],
    });
  } catch (err) {
    // A sibling continuation already owns this stream and will finalize it.
    // This continuation still delivers through the normal response path.
    if (isDuplicateContinuationError(err)) return;
    throw err;
  }
}

export async function getA2AContinuationForIntegrationTask(
  integrationTaskId: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_a2a_continuations
          WHERE integration_task_id = ?
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [integrationTaskId],
  });
  return rows[0] ? rowToContinuation(rows[0] as Record<string, unknown>) : null;
}

export async function getA2AContinuationsForIntegrationTaskAgent(
  integrationTaskId: string,
  agentUrl: string,
  dedupeKey?: string | null,
): Promise<A2AContinuation[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute(
    dedupeKey
      ? {
          sql: `SELECT * FROM integration_a2a_continuations
                WHERE integration_task_id = ? AND agent_url = ? AND dedupe_key = ?
                ORDER BY created_at ASC`,
          args: [integrationTaskId, agentUrl, dedupeKey],
        }
      : {
          sql: `SELECT * FROM integration_a2a_continuations
                WHERE integration_task_id = ? AND agent_url = ?
                ORDER BY created_at ASC`,
          args: [integrationTaskId, agentUrl],
        },
  );
  return rows.map((row) => rowToContinuation(row as Record<string, unknown>));
}

function isDuplicateContinuationError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "23505") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("unique") ||
    msg.includes("duplicate entry") ||
    msg.includes("duplicate key")
  );
}

async function findA2AContinuation(
  integrationTaskId: string,
  agentUrl: string,
  a2aTaskId: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_a2a_continuations
          WHERE integration_task_id = ? AND agent_url = ? AND a2a_task_id = ?
          LIMIT 1`,
    args: [integrationTaskId, agentUrl, a2aTaskId],
  });
  return rows[0] ? rowToContinuation(rows[0] as Record<string, unknown>) : null;
}

export async function getA2AContinuation(
  id: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_a2a_continuations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? rowToContinuation(rows[0] as Record<string, unknown>) : null;
}

export async function claimA2AContinuation(
  id: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const processingCutoff = now - PROCESSING_STUCK_AFTER_MS;
  const staleNextCheckCutoff = now - PROCESSING_NEXT_CHECK_STALE_AFTER_MS;
  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_a2a_continuations
           SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'processing'
               AND (updated_at <= ? OR next_check_at <= ?)
             )
           )
         RETURNING *`
      : `UPDATE integration_a2a_continuations
           SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'processing'
               AND (updated_at <= ? OR next_check_at <= ?)
             )
           )`,
    args: ["processing", now, id, processingCutoff, staleNextCheckCutoff],
  });
  const rows = result.rows ?? [];
  if (isPostgres()) {
    return rows[0]
      ? rowToContinuation(rows[0] as Record<string, unknown>)
      : null;
  }
  const affected = (result as any)?.rowsAffected ?? (result as any)?.rowCount;
  if (affected === 0) return null;
  const fetched = await getA2AContinuation(id);
  if (!fetched || fetched.status !== "processing") return null;
  return fetched;
}

export async function claimDueA2AContinuations(
  limit = 5,
): Promise<A2AContinuation[]> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const processingCutoff = now - PROCESSING_STUCK_AFTER_MS;
  const staleNextCheckCutoff = now - PROCESSING_NEXT_CHECK_STALE_AFTER_MS;
  // If a processor dies while holding a delivery claim, retry the final send.
  // The stale cutoff preserves the in-flight delivery guard while keeping
  // final integration replies at-least-once.
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, next_check_at = ?, updated_at = ?
          WHERE status = 'delivering' AND updated_at <= ?`,
    args: ["pending", now, now, now - 5 * 60 * 1000],
  });
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, next_check_at = ?, updated_at = ?
          WHERE status = 'processing'
            AND (updated_at <= ? OR next_check_at <= ?)`,
    args: ["pending", now, now, processingCutoff, staleNextCheckCutoff],
  });
  const { rows } = await client.execute({
    sql: `SELECT id FROM integration_a2a_continuations
          WHERE status = 'pending' AND next_check_at <= ?
          ORDER BY next_check_at ASC
          LIMIT ?`,
    args: [now, limit],
  });
  const claimed: A2AContinuation[] = [];
  for (const row of rows) {
    const continuation = await claimA2AContinuation(row.id as string);
    if (continuation) claimed.push(continuation);
  }
  return claimed;
}

export async function claimA2AContinuationDelivery(
  id: string,
): Promise<A2AContinuation | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_a2a_continuations
           SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'
         RETURNING *`
      : `UPDATE integration_a2a_continuations
           SET status = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'`,
    args: ["delivering", now, id],
  });
  const rows = result.rows ?? [];
  if (isPostgres()) {
    return rows[0]
      ? rowToContinuation(rows[0] as Record<string, unknown>)
      : null;
  }
  const affected = (result as any)?.rowsAffected ?? (result as any)?.rowCount;
  if (affected === 0) return null;
  const fetched = await getA2AContinuation(id);
  if (!fetched || fetched.status !== "delivering") return null;
  return fetched;
}

export async function rescheduleA2AContinuation(
  id: string,
  delayMs: number,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, next_check_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('processing', 'delivering')`,
    args: ["pending", now + delayMs, now, id],
  });
}

export async function completeA2AContinuation(id: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, updated_at = ?, completed_at = ?,
              incoming_payload = ?, a2a_auth_token = NULL, progress_ref = NULL
          WHERE id = ? AND status IN ('processing', 'delivering', 'completed')`,
    args: ["completed", now, now, "{}", id],
  });
}

export async function failA2AContinuation(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_a2a_continuations
          SET status = ?, updated_at = ?, error_message = ?,
              incoming_payload = ?, a2a_auth_token = NULL, progress_ref = NULL
          WHERE id = ? AND status <> 'completed'`,
    args: ["failed", now, errorMessage.slice(0, 2000), "{}", id],
  });
}
