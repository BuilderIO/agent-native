/**
 * SQL-backed pending task queue for integration webhooks.
 *
 * Why this exists: serverless platforms (Netlify Lambda, Vercel, Cloudflare
 * Workers) freeze the function execution as soon as the HTTP response is
 * returned. Fire-and-forget background `Promise`s get killed mid-flight,
 * meaning agent loops triggered from a Slack/Telegram webhook never finish.
 *
 * Solution: persist the inbound message to SQL inside the webhook handler,
 * then dispatch a fresh HTTP POST to a separate processor endpoint. Each
 * invocation gets its own fresh function timeout budget.
 */
import { getDbExec, isPostgres, intType } from "../db/client.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS integration_pending_tasks (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          external_thread_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          status TEXT NOT NULL,
          attempts ${intType()} NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          completed_at ${intType()}
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_pending_tasks_status_created ON integration_pending_tasks(status, created_at)`,
      );
      // Additive migration: add a stable per-event dedup key so duplicate
      // webhook deliveries from the same platform get rejected at the SQL
      // layer instead of via an in-memory Map (which doesn't survive
      // serverless cold starts — H3 in the webhook security audit). The
      // unique index ensures a duplicate INSERT raises an error we can
      // catch as "already-enqueued".
      await ensureExternalEventKey(client);
      await client.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_tasks_event_key ON integration_pending_tasks(platform, external_event_key)`,
      );
    })();
  }
  return _initPromise;
}

async function ensureExternalEventKey(
  client: ReturnType<typeof getDbExec>,
): Promise<void> {
  if (isPostgres()) {
    await client.execute(
      `ALTER TABLE integration_pending_tasks ADD COLUMN IF NOT EXISTS external_event_key TEXT`,
    );
    return;
  }
  // SQLite doesn't support `ADD COLUMN IF NOT EXISTS` until 3.35; swallow
  // the duplicate-column error so reruns are idempotent.
  try {
    await client.execute(
      `ALTER TABLE integration_pending_tasks ADD COLUMN external_event_key TEXT`,
    );
  } catch (err: any) {
    if (
      !String(err?.message ?? err)
        .toLowerCase()
        .includes("duplicate")
    ) {
      throw err;
    }
  }
}

/** Status values for an integration pending task. */
export type PendingTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface PendingTask {
  id: string;
  platform: string;
  externalThreadId: string;
  payload: string;
  ownerEmail: string;
  orgId: string | null;
  status: PendingTaskStatus;
  attempts: number;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

function rowToTask(row: Record<string, unknown>): PendingTask {
  return {
    id: row.id as string,
    platform: row.platform as string,
    externalThreadId: row.external_thread_id as string,
    payload: row.payload as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    status: row.status as PendingTaskStatus,
    attempts: Number(row.attempts ?? 0),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    completedAt:
      row.completed_at == null ? null : Number(row.completed_at as number),
  };
}

/**
 * Insert a new pending task. Returns the generated task id.
 *
 * If `externalEventKey` is supplied, the unique index on
 * `(platform, external_event_key)` will reject duplicates — callers should
 * catch the resulting constraint-violation error and treat it as
 * "already enqueued" instead of a hard failure (H3 in the webhook security
 * audit). This is the SQL-backed replacement for the in-memory dedup map.
 */
export async function insertPendingTask(input: {
  id: string;
  platform: string;
  externalThreadId: string;
  payload: string;
  ownerEmail: string;
  orgId?: string | null;
  externalEventKey?: string | null;
}): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO integration_pending_tasks
      (id, platform, external_thread_id, payload, owner_email, org_id, status, attempts, created_at, updated_at, external_event_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.platform,
      input.externalThreadId,
      input.payload,
      input.ownerEmail,
      input.orgId ?? null,
      "pending",
      0,
      now,
      now,
      input.externalEventKey ?? null,
    ],
  });
}

/**
 * Returns whether a duplicate-event error from `insertPendingTask` looks
 * like a unique-constraint violation on `(platform, external_event_key)`.
 *
 * Postgres surfaces these as `error.code === "23505"`, while SQLite uses
 * a substring match on the error text. Used by the webhook handler to
 * distinguish "already enqueued" (silently OK) from genuine insert failures.
 */
export function isDuplicateEventError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "23505") return true; // Postgres unique-violation
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("unique") ||
    msg.includes("duplicate entry") ||
    msg.includes("duplicate key")
  );
}

/** Fetch a pending task by id. */
export async function getPendingTask(id: string): Promise<PendingTask | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, platform, external_thread_id, payload, owner_email, org_id, status, attempts, error_message, created_at, updated_at, completed_at
          FROM integration_pending_tasks WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToTask(rows[0] as Record<string, unknown>);
}

/**
 * Atomically claim a task: transition pending → processing and increment
 * attempts. Returns the updated task if the transition succeeded, otherwise
 * null (e.g. the task was already claimed by a concurrent worker).
 */
export async function claimPendingTask(
  id: string,
): Promise<PendingTask | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  // Conditional update: only flip if currently pending. Failed tasks are
  // terminal unless an explicit retry path resets them to pending first.
  const { rows } = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_pending_tasks
         SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'
         RETURNING id, platform, external_thread_id, payload, owner_email, org_id, status, attempts, error_message, created_at, updated_at, completed_at`
      : `UPDATE integration_pending_tasks
         SET status = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
    args: ["processing", now, id],
  });

  if (isPostgres()) {
    if (rows.length === 0) return null;
    return rowToTask(rows[0] as Record<string, unknown>);
  }

  // SQLite: no RETURNING, so re-read after the update. Confirm we actually
  // moved it into 'processing' (vs. lost the race).
  const fetched = await getPendingTask(id);
  if (!fetched || fetched.status !== "processing") return null;
  return fetched;
}

/** Mark a task as completed. */
export async function markTaskCompleted(id: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?, updated_at = ?, completed_at = ?
          WHERE id = ?`,
    args: ["completed", now, now, id],
  });
}

/** Mark a task as failed and stash an error message. */
export async function markTaskFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?, updated_at = ?, error_message = ?
          WHERE id = ?`,
    args: ["failed", now, errorMessage.slice(0, 2000), id],
  });
}
