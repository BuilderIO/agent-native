import { getDbExec } from "../db/client.js";
import {
  ensureTableExists,
  ensureColumnExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;
export const MAX_PENDING_TASK_ATTEMPTS = 3;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `CREATE TABLE IF NOT EXISTS integration_pending_tasks (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_thread_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  status TEXT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  dispatch_attempts BIGINT NOT NULL DEFAULT 0,
  last_dispatch_at BIGINT,
  last_dispatch_outcome TEXT,
  dispatch_scope TEXT,
  error_message TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
)`;

      {
        await ensureTableExists("integration_pending_tasks", createSql);
        await ensureColumnExists(
          "integration_pending_tasks",
          "external_event_key",
          `ALTER TABLE integration_pending_tasks ADD COLUMN IF NOT EXISTS external_event_key TEXT`,
        );
        await ensureColumnExists(
          "integration_pending_tasks",
          "dispatch_attempts",
          `ALTER TABLE integration_pending_tasks ADD COLUMN IF NOT EXISTS dispatch_attempts BIGINT NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "integration_pending_tasks",
          "last_dispatch_at",
          `ALTER TABLE integration_pending_tasks ADD COLUMN IF NOT EXISTS last_dispatch_at BIGINT`,
        );
        await ensureColumnExists(
          "integration_pending_tasks",
          "last_dispatch_outcome",
          `ALTER TABLE integration_pending_tasks ADD COLUMN IF NOT EXISTS last_dispatch_outcome TEXT`,
        );
        await ensureColumnExists(
          "integration_pending_tasks",
          "dispatch_scope",
          `ALTER TABLE integration_pending_tasks ADD COLUMN IF NOT EXISTS dispatch_scope TEXT`,
        );
        await ensureIndexExists(
          "idx_pending_tasks_status_created",
          `CREATE INDEX IF NOT EXISTS idx_pending_tasks_status_created ON integration_pending_tasks(status, created_at)`,
        );
        await ensureIndexExists(
          "idx_pending_tasks_event_key",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_tasks_event_key ON integration_pending_tasks(platform, external_event_key)`,
        );
        await ensureIndexExists(
          "idx_pending_tasks_dispatch_scope",
          `CREATE INDEX IF NOT EXISTS idx_pending_tasks_dispatch_scope ON integration_pending_tasks(platform, dispatch_scope)`,
        );
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function ensurePendingTasksTable(): Promise<void> {
  await ensureTable();
}

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
  dispatchAttempts: number;
  lastDispatchAt: number | null;
  lastDispatchOutcome: string | null;
  dispatchScope: string | null;
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
    dispatchAttempts: Number(row.dispatch_attempts ?? 0),
    lastDispatchAt:
      row.last_dispatch_at == null
        ? null
        : Number(row.last_dispatch_at as number),
    lastDispatchOutcome: (row.last_dispatch_outcome as string | null) ?? null,
    dispatchScope: (row.dispatch_scope as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    completedAt:
      row.completed_at == null ? null : Number(row.completed_at as number),
  };
}

export async function insertPendingTask(input: {
  id: string;
  platform: string;
  externalThreadId: string;
  payload: string;
  ownerEmail: string;
  orgId?: string | null;
  externalEventKey?: string | null;
  dispatchScope?: string | null;
}): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO integration_pending_tasks
      (id, platform, external_thread_id, payload, owner_email, org_id, status, attempts, created_at, updated_at, external_event_key, dispatch_scope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.dispatchScope ?? null,
    ],
  });
}

export function isDuplicateEventError(err: unknown): boolean {
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

export async function getPendingTask(id: string): Promise<PendingTask | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, platform, external_thread_id, payload, owner_email, org_id, status, attempts, dispatch_attempts, last_dispatch_at, last_dispatch_outcome, dispatch_scope, error_message, created_at, updated_at, completed_at
          FROM integration_pending_tasks WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToTask(rows[0] as Record<string, unknown>);
}

export interface ResolvedIntegrationSourceContext {
  platform: "slack";
  sourceUrl: string;
}

type PendingTaskSourceRow = Pick<
  PendingTask,
  "platform" | "payload" | "ownerEmail" | "orgId"
>;

export function sourceContextFromPendingTask(
  task: PendingTaskSourceRow | null,
  ownerEmail: string,
  orgId: string | null,
): ResolvedIntegrationSourceContext | null {
  if (
    !task ||
    task.ownerEmail !== ownerEmail ||
    task.orgId !== orgId ||
    task.platform !== "slack"
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(task.payload) as Record<string, unknown>;
    const incoming = payload.incoming;
    if (!incoming || typeof incoming !== "object") return null;
    const incomingRecord = incoming as Record<string, unknown>;
    if (incomingRecord.platform !== "slack") return null;
    const sourceUrl = incomingRecord.sourceUrl;
    if (
      typeof sourceUrl !== "string" ||
      !sourceUrl ||
      sourceUrl !== sourceUrl.trim()
    ) {
      return null;
    }

    const parsed = new URL(sourceUrl);
    const isSlackHost =
      parsed.hostname === "slack.com" || parsed.hostname.endsWith(".slack.com");
    if (
      parsed.protocol !== "https:" ||
      !isSlackHost ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return null;
    }
    return { platform: "slack", sourceUrl };
  } catch {
    return null;
  }
}

export async function resolveIntegrationSourceContext(
  id: string,
  ownerEmail: string,
  orgId: string | null,
): Promise<ResolvedIntegrationSourceContext | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT platform, payload, owner_email, org_id
          FROM integration_pending_tasks
          WHERE id = ?
            AND owner_email = ?
            AND (org_id = ? OR (org_id IS NULL AND CAST(? AS TEXT) IS NULL))
            AND platform = 'slack'
          LIMIT 1`,
    args: [id, ownerEmail, orgId, orgId],
  });
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return sourceContextFromPendingTask(
    {
      platform: row.platform as string,
      payload: row.payload as string,
      ownerEmail: row.owner_email as string,
      orgId: (row.org_id as string | null) ?? null,
    },
    ownerEmail,
    orgId,
  );
}

export async function claimPendingTask(
  id: string,
  options?: { dispatchOutcome?: string },
): Promise<PendingTask | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  const result = await client.execute({
    sql: `UPDATE integration_pending_tasks
         SET status = ?, attempts = attempts + 1, updated_at = ?,
             last_dispatch_outcome = COALESCE(?, last_dispatch_outcome)
         WHERE id = ? AND status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM integration_pending_tasks active
             WHERE active.platform = integration_pending_tasks.platform
               AND active.external_thread_id = integration_pending_tasks.external_thread_id
               AND active.status = 'processing'
               AND active.id <> integration_pending_tasks.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM integration_pending_tasks earlier
             WHERE earlier.platform = integration_pending_tasks.platform
               AND earlier.external_thread_id = integration_pending_tasks.external_thread_id
               AND earlier.status = 'pending'
               AND (
                 earlier.created_at < integration_pending_tasks.created_at
                 OR (
                   earlier.created_at = integration_pending_tasks.created_at
                   AND earlier.id < integration_pending_tasks.id
                 )
               )
           )
         RETURNING id, platform, external_thread_id, payload, owner_email, org_id, status, attempts, dispatch_attempts, last_dispatch_at, last_dispatch_outcome, dispatch_scope, error_message, created_at, updated_at, completed_at`,
    args: ["processing", now, options?.dispatchOutcome ?? null, id],
  });
  const rows = result.rows ?? [];

  if (rows.length === 0) return null;
  return rowToTask(rows[0] as Record<string, unknown>);
}

export async function recordPendingTaskDispatchAttempt(
  id: string,
  outcome: string,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `UPDATE integration_pending_tasks
          SET dispatch_attempts = dispatch_attempts + 1,
              last_dispatch_at = ?,
              last_dispatch_outcome = CASE
                WHEN status = 'processing'
                  AND last_dispatch_outcome = 'background-acknowledged'
                THEN last_dispatch_outcome
                ELSE ?
              END
          WHERE id = ?`,
    args: [Date.now(), outcome.slice(0, 80), id],
  });
}

export async function getNextPendingTaskForThread(
  platform: string,
  externalThreadId: string,
): Promise<{ id: string; dispatchScope: string | null } | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, dispatch_scope FROM integration_pending_tasks
      WHERE platform = ? AND external_thread_id = ? AND status = 'pending'
      ORDER BY created_at ASC, id ASC LIMIT 1`,
    args: [platform, externalThreadId],
  });
  return rows[0]?.id
    ? {
        id: String(rows[0].id),
        dispatchScope: (rows[0].dispatch_scope as string | null) ?? null,
      }
    : null;
}

export async function markTaskCompleted(id: string): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?, updated_at = ?, completed_at = ?, payload = ?
          WHERE id = ?`,
    args: ["completed", now, now, "{}", id],
  });
}

export async function markTaskRetryable(
  id: string,
  errorMessage: string,
  options?: { resetAttempts?: boolean },
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const attempts = options?.resetAttempts ? ", attempts = 0" : "";
  await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?${attempts}, updated_at = ?, error_message = ?
          WHERE id = ? AND status = 'processing'`,
    args: ["pending", now, errorMessage.slice(0, 2000), id],
  });
}

export async function stageTaskDeliveryPayload(
  id: string,
  payload: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const result = await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET payload = ?, updated_at = ?
          WHERE id = ? AND status = 'processing'`,
    args: [payload, now, id],
  });
  const affected = Number(
    (result as { rowsAffected?: number }).rowsAffected ??
      (result as { rowCount?: number }).rowCount ??
      0,
  );
  if (affected === 0) {
    throw new Error("Integration task is no longer claimable for delivery");
  }
}

export async function markTaskDeliveryRetryable(
  id: string,
  payload: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?, payload = ?, updated_at = ?, error_message = ?
          WHERE id = ? AND status = 'processing'`,
    args: ["pending", payload, Date.now(), errorMessage.slice(0, 2000), id],
  });
  const affected = Number(
    (result as { rowsAffected?: number }).rowsAffected ??
      (result as { rowCount?: number }).rowCount ??
      0,
  );
  if (affected === 0) {
    throw new Error(
      "Integration task is no longer claimable for delivery retry",
    );
  }
}

export async function failTaskDeliveryTransition(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?, updated_at = ?, error_message = ?, payload = ?
          WHERE id = ? AND status = 'processing'`,
    args: ["failed", Date.now(), errorMessage.slice(0, 2000), "{}", id],
  });
  const affected = Number(
    (result as { rowsAffected?: number }).rowsAffected ??
      (result as { rowCount?: number }).rowCount ??
      0,
  );
  if (affected === 0) {
    throw new Error(
      "Integration task delivery failure transition lost its race",
    );
  }
}

export async function markTaskFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: `UPDATE integration_pending_tasks
          SET status = ?, updated_at = ?, error_message = ?, payload = ?, external_event_key = NULL
          WHERE id = ?`,
    args: ["failed", now, errorMessage.slice(0, 2000), "{}", id],
  });
}
