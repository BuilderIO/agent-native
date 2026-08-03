import { randomUUID } from "node:crypto";

import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

/**
 * "interrupted" is derived at read time, never stored: a process killed
 * mid-run cannot write its own outcome, so a row left running long past the
 * point a run could still be alive is reported as interrupted rather than
 * shown as permanently in-flight.
 */
export type AutomationRunStatus =
  | "running"
  | "success"
  | "error"
  | "interrupted";

export interface AutomationRun {
  id: string;
  owner: string;
  automation: string;
  path: string;
  scope: string | null;
  orgId: string | null;
  runId: string | null;
  threadId: string | null;
  status: AutomationRunStatus;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface StartAutomationRunInput {
  owner: string;
  automation: string;
  path: string;
  scope?: string | null;
  orgId?: string | null;
  runId?: string | null;
  threadId?: string | null;
}

const TABLE = "automation_runs";
const MAX_ERROR_LENGTH = 500;

/**
 * Generous multiple of the runner's own 5 minute hard abort
 * (BACKGROUND_RUN_HARD_TIMEOUT_MS). Past this, no run is still alive.
 */
const RUN_LIVENESS_CEILING_MS = 15 * 60_000;

/** Rows kept per automation, so a per-minute schedule cannot grow forever. */
const RUNS_RETAINED_PER_AUTOMATION = 50;

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          automation TEXT NOT NULL,
          path TEXT NOT NULL,
          scope TEXT,
          org_id TEXT,
          run_id TEXT,
          thread_id TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          started_at ${intType()} NOT NULL,
          finished_at ${intType()},
          error TEXT
        )
      `;
      const indexSql = `CREATE INDEX IF NOT EXISTS idx_${TABLE}_owner_automation ON ${TABLE} (owner, automation, started_at)`;

      if (isPostgres()) {
        await ensureTableExists(TABLE, createSql);
        await ensureIndexExists(`idx_${TABLE}_owner_automation`, indexSql);
        return;
      }

      await client.execute(createSql);
      await client.execute(indexSql);
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function toRun(row: Record<string, unknown>, now: number): AutomationRun {
  const stored = String(row.status) as AutomationRunStatus;
  const startedAt = Number(row.started_at);
  const status: AutomationRunStatus =
    stored === "running" && now - startedAt > RUN_LIVENESS_CEILING_MS
      ? "interrupted"
      : stored;
  return {
    id: String(row.id),
    owner: String(row.owner),
    automation: String(row.automation),
    path: String(row.path),
    scope: row.scope == null ? null : String(row.scope),
    orgId: row.org_id == null ? null : String(row.org_id),
    runId: row.run_id == null ? null : String(row.run_id),
    threadId: row.thread_id == null ? null : String(row.thread_id),
    status,
    startedAt,
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    error: row.error == null ? null : String(row.error),
  };
}

/**
 * Record that an automation actually began executing. Returns the run id used
 * to close the record out. Only real executions get a row — a tick that
 * declined to run the automation must not appear in its history.
 */
export async function startAutomationRun(
  input: StartAutomationRunInput,
): Promise<string> {
  await ensureTable();
  const id = randomUUID();
  await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (id, owner, automation, path, scope, org_id, run_id, thread_id, status, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    args: [
      id,
      input.owner,
      input.automation,
      input.path,
      input.scope ?? null,
      input.orgId ?? null,
      input.runId ?? null,
      input.threadId ?? null,
      Date.now(),
    ],
  });
  await pruneAutomationRuns(input.owner, input.automation);
  return id;
}

/**
 * Drop the oldest rows for one automation once it exceeds the retention cap.
 *
 * Pruning on insert keeps the table bounded by the number of automations
 * rather than by how often they run, and avoids a separate sweeper. The
 * derived table is aliased because Postgres requires it.
 */
async function pruneAutomationRuns(
  owner: string,
  automation: string,
): Promise<void> {
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE}
          WHERE owner = ? AND automation = ? AND started_at < (
            SELECT MIN(started_at) FROM (
              SELECT started_at FROM ${TABLE}
              WHERE owner = ? AND automation = ?
              ORDER BY started_at DESC
              LIMIT ${RUNS_RETAINED_PER_AUTOMATION}
            ) recent
          )`,
    args: [owner, automation, owner, automation],
  });
}

export async function finishAutomationRun(
  id: string,
  status: Exclude<AutomationRunStatus, "running">,
  error?: string,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET status = ?, finished_at = ?, error = ? WHERE id = ?`,
    args: [status, Date.now(), error?.slice(0, MAX_ERROR_LENGTH) ?? null, id],
  });
}

/**
 * Attach the agent thread once it exists. The thread is created after the run
 * row so the history survives a crash between the two.
 */
export async function attachAutomationRunThread(
  id: string,
  threadId: string,
  runId: string,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET thread_id = ?, run_id = ? WHERE id = ?`,
    args: [threadId, runId, id],
  });
}

/**
 * Forget an automation's executions.
 *
 * History is keyed by the automation's name, which is reusable: deleting
 * "digest" and creating a new "digest" would otherwise show the old
 * definition's runs as the new one's history.
 */
export async function deleteAutomationRuns(
  owner: string,
  automation: string,
): Promise<void> {
  await ensureTable();
  // Bounded to runs that had already started. Names are reusable, so if a new
  // automation takes this name and starts running before the cleanup lands,
  // the cutoff keeps that run's history from being swept up with the old
  // definition's.
  const cutoff = Date.now();
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE} WHERE owner = ? AND automation = ? AND started_at <= ?`,
    args: [owner, automation, cutoff],
  });
}

export async function listAutomationRuns(options: {
  owners: string[];
  automation: string;
  limit?: number;
}): Promise<AutomationRun[]> {
  await ensureTable();
  const owners = options.owners.filter(Boolean);
  if (!owners.length) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const placeholders = owners.map(() => "?").join(", ");
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE owner IN (${placeholders}) AND automation = ?
          ORDER BY started_at DESC LIMIT ${limit}`,
    args: [...owners, options.automation],
  });
  const now = Date.now();
  return (result.rows ?? []).map((row) =>
    toRun(row as Record<string, unknown>, now),
  );
}
