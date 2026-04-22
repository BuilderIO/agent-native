import { randomUUID } from "node:crypto";
import {
  getDbExec,
  intType,
  retryOnDdlRace,
  safeJsonParse,
} from "../db/client.js";
import { recordChange } from "../server/poll.js";

function bumpPoll(owner: string): void {
  recordChange({ source: "runs", type: "change", key: owner });
}
import type {
  AgentRun,
  ListRunsOptions,
  ProgressStatus,
  StartRunInput,
  UpdateProgressInput,
} from "./types.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await retryOnDdlRace(() =>
        client.execute(`
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
        `),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_progress_runs_owner_status ON progress_runs (owner, status, started_at)`,
        ),
      );
      // NOTE: table name is `progress_runs` (not `agent_runs`) to avoid
      // colliding with core's existing agent/run-store.ts which uses
      // `agent_runs` for agent-chat turn lifecycle tracking. These are
      // separate concerns — progress = user-facing task status, agent_runs =
      // internal chat turn bookkeeping.
    })();
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
  const now = Date.now();
  const sets: string[] = ["updated_at = ?"];
  const args: Array<string | number | null> = [now];

  if (Object.prototype.hasOwnProperty.call(input, "percent")) {
    sets.push("percent = ?");
    args.push(input.percent == null ? null : clampPercent(input.percent));
  }
  if (input.step !== undefined) {
    sets.push("step = ?");
    args.push(input.step);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    args.push(JSON.stringify(input.metadata));
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    args.push(input.status);
    if (input.status !== "running") {
      sets.push("completed_at = ?");
      args.push(now);
    }
  }
  args.push(id, owner);

  const res = await client.execute({
    sql: `UPDATE progress_runs SET ${sets.join(", ")} WHERE id = ? AND owner = ?`,
    args,
  });
  if ((res as unknown as { rowsAffected?: number }).rowsAffected === 0) {
    return null;
  }
  bumpPoll(owner);
  return getRun(id, owner);
}

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function listRuns(
  owner: string,
  options: ListRunsOptions = {},
): Promise<AgentRun[]> {
  await ensureTable();
  const client = getDbExec();
  const limit = Math.min(options.limit ?? 50, 200);
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
