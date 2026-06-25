import { randomUUID } from "node:crypto";

import {
  getDbExec,
  intType,
  isPostgres,
  isUniqueViolation,
  safeJsonParse,
} from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { recordChange } from "../server/poll.js";
import type {
  AgentRun,
  ListRunsOptions,
  ProgressStatus,
  StartRunInput,
  UpdateProgressInput,
} from "./types.js";

function bumpPoll(owner: string): void {
  recordChange({ source: "runs", type: "change", key: owner });
}

let _initPromise: Promise<void> | undefined;

export const DEFAULT_PROGRESS_RUN_STALE_MS = 5 * 60 * 1000;

function normalizeLimit(value: number | undefined, fallback = 50): number {
  if (!Number.isFinite(value) || value == null || value <= 0) return fallback;
  return Math.min(Math.floor(value), 200);
}

function resolveProgressRunStaleMs(): number {
  const raw = process.env.AGENT_PROGRESS_RUN_STALE_MS;
  if (raw !== undefined) {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return DEFAULT_PROGRESS_RUN_STALE_MS;
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS progress_runs (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          title TEXT NOT NULL,
          step TEXT,
          percent ${intType()},
          status TEXT NOT NULL DEFAULT 'running',
          metadata TEXT,
          started_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          completed_at ${intType()}
        )
      `;

      if (isPostgres()) {
        // PG-guard: probe information_schema / pg_indexes before issuing DDL to
        // avoid ACCESS EXCLUSIVE lock contention in fresh background-worker processes.
        await ensureTableExists("progress_runs", createSql);
        await ensureIndexExists(
          "idx_progress_runs_owner_status",
          `CREATE INDEX IF NOT EXISTS idx_progress_runs_owner_status ON progress_runs (owner, status, started_at)`,
        );
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      // NOTE: table name is `progress_runs` (not `agent_runs`) to avoid
      // colliding with core's existing agent/run-store.ts which uses
      // `agent_runs` for agent-chat turn lifecycle tracking. These are
      // separate concerns — progress = user-facing task status, agent_runs =
      // internal chat turn bookkeeping.
      await client.execute(createSql);
      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS idx_progress_runs_owner_status ON progress_runs (owner, status, started_at)`,
        );
      } catch {
        // Index already exists or the dialect rejected a duplicate.
      }
    })().catch((err) => {
      // Reset on failure so a transient DB outage doesn't poison the cached
      // promise and reject every future insert/update call for the lifetime
      // of the process.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function parseRow(row: Record<string, unknown>): AgentRun {
  const percent = row.percent;
  return {
    id: String(row.id),
    owner: String(row.owner),
    title: String(row.title),
    step: row.step == null ? undefined : String(row.step),
    percent: percent == null ? null : Number(percent),
    status: String(row.status) as ProgressStatus,
    metadata: row.metadata
      ? safeJsonParse<Record<string, unknown> | undefined>(
          row.metadata,
          undefined,
        )
      : undefined,
    startedAt: new Date(Number(row.started_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    completedAt:
      row.completed_at == null
        ? null
        : new Date(Number(row.completed_at)).toISOString(),
  };
}

export async function insertRun(input: StartRunInput): Promise<AgentRun> {
  await ensureTable();
  const client = getDbExec();
  const id = input.id ?? randomUUID();
  const now = Date.now();
  try {
    await client.execute({
      sql: `INSERT INTO progress_runs
        (id, owner, title, step, percent, status, metadata, started_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, NULL, 'running', ?, ?, ?, NULL)`,
      args: [
        id,
        input.owner,
        input.title,
        input.step ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now,
      ],
    });
  } catch (err) {
    if (input.id && isUniqueViolation(err)) {
      throw new Error(
        `insertRun: run id "${input.id}" already exists for this owner`,
      );
    }
    throw err;
  }
  bumpPoll(input.owner);
  return {
    id,
    owner: input.owner,
    title: input.title,
    step: input.step,
    percent: null,
    status: "running",
    metadata: input.metadata,
    startedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    completedAt: null,
  };
}

export async function getRun(
  id: string,
  owner: string,
): Promise<AgentRun | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM progress_runs WHERE id = ? AND owner = ?`,
    args: [id, owner],
  });
  if (rows.length === 0) return null;
  return parseRow(rows[0] as Record<string, unknown>);
}

export async function updateRun(
  id: string,
  owner: string,
  input: UpdateProgressInput,
): Promise<AgentRun | null> {
  await ensureTable();
  const client = getDbExec();
  // Read current row first so we can return a consistent snapshot of this
  // caller's update (avoids the UPDATE→SELECT race where a concurrent writer
  // could have their change reflected in the returned value).
  const current = await getRun(id, owner);
  if (!current) return null;

  const now = Date.now();
  const sets: string[] = ["updated_at = ?"];
  const args: Array<string | number | null> = [now];
  const next: AgentRun = {
    ...current,
    updatedAt: new Date(now).toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(input, "percent")) {
    const percent = input.percent == null ? null : clampPercent(input.percent);
    sets.push("percent = ?");
    args.push(percent);
    next.percent = percent;
  }
  if (input.step !== undefined) {
    sets.push("step = ?");
    args.push(input.step);
    next.step = input.step;
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    args.push(JSON.stringify(input.metadata));
    next.metadata = input.metadata;
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    args.push(input.status);
    next.status = input.status;
    if (input.status !== "running") {
      sets.push("completed_at = ?");
      args.push(now);
      next.completedAt = new Date(now).toISOString();
    }
  }
  args.push(id, owner);

  await client.execute({
    sql: `UPDATE progress_runs SET ${sets.join(", ")} WHERE id = ? AND owner = ?`,
    args,
  });
  bumpPoll(owner);
  return next;
}

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function cancelStaleRunsForOwner(
  owner: string,
  staleMs: number = resolveProgressRunStaleMs(),
): Promise<number> {
  if (!Number.isFinite(staleMs) || staleMs <= 0) return 0;
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const cutoff = now - staleMs;
  const minutes = Math.max(1, Math.round(staleMs / 60_000));
  const res = await client.execute({
    sql: `UPDATE progress_runs
          SET status = 'cancelled',
              step = ?,
              updated_at = ?,
              completed_at = ?
          WHERE owner = ?
            AND status = 'running'
            AND updated_at < ?`,
    args: [
      `Stopped after ${minutes} minutes without progress.`,
      now,
      now,
      owner,
      cutoff,
    ],
  });
  const rowsAffected = (res as unknown as { rowsAffected?: number })
    .rowsAffected;
  if (typeof rowsAffected === "number" && rowsAffected > 0) {
    bumpPoll(owner);
    return rowsAffected;
  }
  return 0;
}

// Throttle the stale-run sweep so the 3s RunsTray poll doesn't issue an
// UPDATE (and, when it cancels something, a poll-bump that triggers another
// listRuns) on every single read. A 30s cadence is plenty given "stale" means
// a run has been alive for many minutes.
const _lastStaleSweep = new Map<string, number>();
const STALE_SWEEP_INTERVAL_MS = 30_000;

/**
 * Optional hook run (throttled) before each owner's run list is read. Lets a
 * producer of progress rows reconcile its own backing state first — e.g. Agent
 * Teams re-fires dropped sub-agent dispatches and marks dead runs failed so the
 * tray shows precise status instead of waiting on the generic stale sweep.
 * Registered by the agent-chat plugin to avoid a layering cycle (this generic
 * store must not import feature modules).
 */
export interface ProgressPreListContext {
  event?: unknown;
}

export type ProgressPreListHook = (
  owner: string,
  context: ProgressPreListContext,
) => Promise<void> | void;
let _preListHook: ProgressPreListHook | undefined;
export function setProgressPreListHook(
  hook: ProgressPreListHook | undefined,
): void {
  _preListHook = hook;
}
const _lastPreListHook = new Map<string, number>();
const PRE_LIST_HOOK_INTERVAL_MS = 8_000;

export async function listRuns(
  owner: string,
  options: ListRunsOptions = {},
): Promise<AgentRun[]> {
  await ensureTable();
  if (_preListHook) {
    const lastHook = _lastPreListHook.get(owner) ?? 0;
    if (Date.now() - lastHook > PRE_LIST_HOOK_INTERVAL_MS) {
      _lastPreListHook.set(owner, Date.now());
      try {
        await _preListHook(owner, { event: options.event });
      } catch {
        // best-effort — never let reconciliation break the list read
      }
    }
  }
  const lastSweep = _lastStaleSweep.get(owner) ?? 0;
  if (Date.now() - lastSweep > STALE_SWEEP_INTERVAL_MS) {
    _lastStaleSweep.set(owner, Date.now());
    await cancelStaleRunsForOwner(owner);
  }
  const client = getDbExec();
  const limit = normalizeLimit(options.limit);
  let where = `owner = ?`;
  const args: Array<string | number> = [owner];
  if (options.activeOnly) where += ` AND status = 'running'`;
  args.push(limit);
  const { rows } = await client.execute({
    sql: `SELECT * FROM progress_runs WHERE ${where} ORDER BY started_at DESC LIMIT ?`,
    args,
  });
  return rows.map((r) => parseRow(r as Record<string, unknown>));
}

export async function deleteRun(id: string, owner: string): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const res = await client.execute({
    sql: `DELETE FROM progress_runs WHERE id = ? AND owner = ?`,
    args: [id, owner],
  });
  const deleted =
    (res as unknown as { rowsAffected?: number }).rowsAffected !== 0;
  if (deleted) bumpPoll(owner);
  return deleted;
}
