import { randomUUID } from "node:crypto";

import { z } from "zod";

import { resolveBackgroundRunHardTimeoutMs } from "../agent/run-manager.js";
import { getDbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { runMigrations, type MigrationEntry } from "../db/migrations.js";
import { emit as emitBusEvent, registerEvent } from "../event-bus/index.js";

registerEvent({
  name: "automation.run.finished",
  description:
    "Fires after a scheduled or manual automation run records a terminal status.",
  payloadSchema: z.object({
    automationRunId: z.string(),
    owner: z.string(),
    automation: z.string(),
    path: z.string(),
    orgId: z.string().nullable(),
    runId: z.string().nullable(),
    threadId: z.string().nullable(),
    status: z.enum(["success", "error", "interrupted"]),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
    durationMs: z.number().nullable(),
  }),
});

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
  appId: string | null;
  runId: string | null;
  threadId: string | null;
  status: AutomationRunStatus;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  errorCode: string | null;
}

export interface StartAutomationRunInput {
  owner: string;
  automation: string;
  path: string;
  scope?: string | null;
  orgId?: string | null;
  appId?: string | null;
  runId?: string | null;
  threadId?: string | null;
  dispatchPending?: boolean;
}

const TABLE = "automation_runs";
const MAX_ERROR_LENGTH = 500;
const MAX_ERROR_CODE_LENGTH = 100;

function resolveRunLivenessCeilingMs(): number {
  return Math.ceil(resolveBackgroundRunHardTimeoutMs() * 1.5);
}
const INTERRUPTED_RUN_MESSAGE =
  "Worker stopped before a terminal result was recorded. The serverless worker may have timed out or been recycled. No delivery was confirmed.";
const INTERRUPTED_RUN_ERROR_CODE = "background_automation_interrupted";

const claimLeaseMs = () => resolveRunLivenessCeilingMs();

const RUNS_RETAINED_PER_AUTOMATION = 50;

export const AUTOMATION_RUN_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "automation-runs-table",
    sql: `
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        automation TEXT NOT NULL,
        path TEXT NOT NULL,
        scope TEXT,
        org_id TEXT,
        app_id TEXT,
        run_id TEXT,
        thread_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT,
        claimed_at INTEGER,
        dispatch_pending INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_${TABLE}_owner_automation
        ON ${TABLE} (owner, automation, started_at)
    `,
  },
  {
    version: 2,
    name: "automation-runs-claimed-at",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS claimed_at INTEGER`,
  },
  {
    version: 3,
    name: "automation-runs-dispatch-pending",
    sql: `ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS dispatch_pending INTEGER NOT NULL DEFAULT 0`,
  },
  {
    version: 4,
    name: "automation-runs-app-id",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS app_id TEXT`,
  },
  {
    version: 5,
    name: "automation-runs-error-code",
    sql: `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS error_code TEXT`,
  },
];

export async function runAutomationRunMigrations(
  nitroApp: unknown,
): Promise<void> {
  await runMigrations(AUTOMATION_RUN_MIGRATIONS, {
    table: "_automation_run_migrations",
  })(nitroApp);
}

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          automation TEXT NOT NULL,
            path TEXT NOT NULL,
            scope TEXT,
            org_id TEXT,
            app_id TEXT,
            run_id TEXT,
          thread_id TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          started_at BIGINT NOT NULL,
          finished_at BIGINT,
          error TEXT,
          error_code TEXT,
          claimed_at BIGINT,
          dispatch_pending BIGINT NOT NULL DEFAULT 0
        )
      `;
      const indexSql = `CREATE INDEX IF NOT EXISTS idx_${TABLE}_owner_automation ON ${TABLE} (owner, automation, started_at)`;

      {
        await ensureTableExists(TABLE, createSql);
        await ensureColumnExists(
          TABLE,
          "claimed_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS claimed_at BIGINT`,
        );
        await ensureColumnExists(
          TABLE,
          "dispatch_pending",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS dispatch_pending BIGINT NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          TABLE,
          "error_code",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS error_code TEXT`,
        );
        await ensureIndexExists(`idx_${TABLE}_owner_automation`, indexSql);
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function toRun(row: Record<string, unknown>, now: number): AutomationRun {
  const stored = stringifyValue(row.status) as AutomationRunStatus;
  const startedAt = Number(row.started_at);
  const status: AutomationRunStatus =
    stored === "running" && now - startedAt > resolveRunLivenessCeilingMs()
      ? "interrupted"
      : stored;
  return {
    id: stringifyValue(row.id),
    owner: stringifyValue(row.owner),
    automation: stringifyValue(row.automation),
    path: stringifyValue(row.path),
    scope: row.scope == null ? null : stringifyValue(row.scope),
    orgId: row.org_id == null ? null : stringifyValue(row.org_id),
    appId: row.app_id == null ? null : stringifyValue(row.app_id),
    runId: row.run_id == null ? null : stringifyValue(row.run_id),
    threadId: row.thread_id == null ? null : stringifyValue(row.thread_id),
    status,
    startedAt,
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    error:
      row.error == null && status === "interrupted"
        ? INTERRUPTED_RUN_MESSAGE
        : row.error == null
          ? null
          : stringifyValue(row.error),
    errorCode:
      row.error_code == null && status === "interrupted"
        ? INTERRUPTED_RUN_ERROR_CODE
        : row.error_code == null
          ? null
          : stringifyValue(row.error_code),
  };
}

export async function startAutomationRun(
  input: StartAutomationRunInput,
): Promise<string> {
  await ensureTable();
  const id = randomUUID();
  await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (id, owner, automation, path, scope, org_id, app_id, run_id, thread_id, status, started_at, dispatch_pending)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    args: [
      id,
      input.owner,
      input.automation,
      input.path,
      input.scope ?? null,
      input.orgId ?? null,
      input.appId ?? null,
      input.runId ?? null,
      input.threadId ?? null,
      Date.now(),
      input.dispatchPending ? 1 : 0,
    ],
  });
  await pruneAutomationRuns(input.owner, input.automation);
  return id;
}

export async function getAutomationRun(
  id: string,
): Promise<AutomationRun | null> {
  await ensureTable();
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? toRun(row, Date.now()) : null;
}

export async function claimAutomationRun(id: string): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET claimed_at = ? WHERE id = ? AND dispatch_pending = 1 AND (claimed_at IS NULL OR claimed_at <= ?) AND status = 'running'`,
    args: [now, id, now - claimLeaseMs()],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

export async function listUnclaimedAutomationRuns(options?: {
  appId?: string | null;
  olderThanMs?: number;
  limit?: number;
}): Promise<AutomationRun[]> {
  await ensureTable();
  const appId = options?.appId?.trim() || null;
  const olderThanMs = Math.max(options?.olderThanMs ?? 10_000, 0);
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const appFilter = appId ? " AND (app_id = ? OR app_id IS NULL)" : "";
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE}
          WHERE dispatch_pending = 1 AND (claimed_at IS NULL OR claimed_at <= ?) AND status = 'running'
            ${appFilter}
            AND started_at <= ?
          ORDER BY started_at ASC LIMIT ${limit}`,
    args: [
      Date.now() - claimLeaseMs(),
      ...(appId ? [appId] : []),
      Date.now() - olderThanMs,
    ],
  });
  const now = Date.now();
  return (result.rows ?? []).map((row) =>
    toRun(row as Record<string, unknown>, now),
  );
}

function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}

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
  errorCode?: string,
): Promise<void> {
  await ensureTable();
  const existing = await getDbExec().execute({
    sql: `SELECT owner, automation, path, org_id, run_id, thread_id, started_at FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = existing.rows?.[0] as Record<string, unknown> | undefined;
  const finishedAt = Date.now();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET status = ?, finished_at = ?, error = ?, error_code = ? WHERE id = ?`,
    args: [
      status,
      finishedAt,
      error?.slice(0, MAX_ERROR_LENGTH) ?? null,
      errorCode?.slice(0, MAX_ERROR_CODE_LENGTH) ?? null,
      id,
    ],
  });
  if (!row) return;
  const rawStartedAt = Number(row.started_at);
  const startedAt = Number.isFinite(rawStartedAt) ? rawStartedAt : null;
  try {
    emitBusEvent(
      "automation.run.finished",
      {
        automationRunId: id,
        owner: stringifyValue(row.owner),
        automation: stringifyValue(row.automation),
        path: stringifyValue(row.path),
        orgId: row.org_id == null ? null : stringifyValue(row.org_id),
        runId: row.run_id == null ? null : stringifyValue(row.run_id),
        threadId: row.thread_id == null ? null : stringifyValue(row.thread_id),
        status,
        error: error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        errorCode: errorCode?.slice(0, MAX_ERROR_CODE_LENGTH) ?? null,
        durationMs:
          startedAt === null ? null : Math.max(0, finishedAt - startedAt),
      },
      { owner: stringifyValue(row.owner) },
    );
  } catch (eventError) {
    console.warn(
      "[automations] terminal-run event delivery failed:",
      eventError,
    );
  }
}

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

export async function deleteAutomationRuns(
  owner: string,
  automation: string,
): Promise<void> {
  await ensureTable();
  const cutoff = Date.now();
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE} WHERE owner = ? AND automation = ? AND started_at <= ?`,
    args: [owner, automation, cutoff],
  });
}

export async function listAutomationRuns(options: {
  owners: string[];
  automation: string;
  appId?: string | null;
  limit?: number;
}): Promise<AutomationRun[]> {
  await ensureTable();
  const owners = options.owners.filter(Boolean);
  if (!owners.length) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const appId = options.appId?.trim() || null;
  const placeholders = owners.map(() => "?").join(", ");
  const appFilter = appId ? " AND (app_id = ? OR app_id IS NULL)" : "";
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE owner IN (${placeholders}) AND automation = ?
          ${appFilter}
          ORDER BY started_at DESC LIMIT ${limit}`,
    args: [...owners, options.automation, ...(appId ? [appId] : [])],
  });
  const now = Date.now();
  return (result.rows ?? []).map((row) =>
    toRun(row as Record<string, unknown>, now),
  );
}
