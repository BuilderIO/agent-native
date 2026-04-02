/**
 * SQL persistence for agent runs and events.
 * Enables cross-isolate access on Cloudflare Workers and
 * reliable reconnection after page refreshes.
 */
import { getDbExec, intType } from "../db/client.js";

let _initialized = false;

async function ensureRunTables(): Promise<void> {
  if (_initialized) return;
  const client = getDbExec();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at ${intType()} NOT NULL,
      completed_at ${intType()}
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS agent_run_events (
      run_id TEXT NOT NULL,
      seq ${intType()} NOT NULL,
      event_data TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    )
  `);
  _initialized = true;
}

export async function insertRun(id: string, threadId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_runs (id, thread_id, status, started_at) VALUES (?, ?, 'running', ?)`,
    args: [id, threadId, Date.now()],
  });
}

export async function updateRunStatus(
  runId: string,
  status: "completed" | "errored",
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?`,
    args: [status, Date.now(), runId],
  });
}

export async function markRunAborted(runId: string): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE agent_runs SET status = 'aborted', completed_at = ? WHERE id = ?`,
    args: [Date.now(), runId],
  });
}

export async function isRunAborted(runId: string): Promise<boolean> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT status FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  return rows.length > 0 && (rows[0] as any).status === "aborted";
}

export async function insertRunEvent(
  runId: string,
  seq: number,
  eventData: string,
): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?)`,
    args: [runId, seq, eventData],
  });
}

export async function getRunEventsSince(
  runId: string,
  fromSeq: number,
): Promise<Array<{ seq: number; eventData: string }>> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT seq, event_data FROM agent_run_events WHERE run_id = ? AND seq >= ? ORDER BY seq ASC`,
    args: [runId, fromSeq],
  });
  return rows.map((r: any) => ({
    seq: Number(r.seq),
    eventData: r.event_data as string,
  }));
}

export async function getRunById(runId: string): Promise<{
  id: string;
  threadId: string;
  status: string;
  startedAt: number;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, status, started_at FROM agent_runs WHERE id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    id: r.id,
    threadId: r.thread_id,
    status: r.status,
    startedAt: Number(r.started_at),
  };
}

export async function getRunByThread(threadId: string): Promise<{
  id: string;
  threadId: string;
  status: string;
  startedAt: number;
} | null> {
  await ensureRunTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, status, started_at FROM agent_runs WHERE thread_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
    args: [threadId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    id: r.id,
    threadId: r.thread_id,
    status: r.status,
    startedAt: Number(r.started_at),
  };
}

/** Delete completed/errored runs older than the given threshold,
 *  and expire stale "running" rows that haven't had activity
 *  (e.g. worker crashed before updating status). */
export async function cleanupOldRuns(olderThanMs: number): Promise<void> {
  await ensureRunTables();
  const client = getDbExec();
  const cutoff = Date.now() - olderThanMs;
  // Expire stale running rows — if started more than threshold ago,
  // the worker likely crashed. Mark as errored so clients stop waiting.
  await client.execute({
    sql: `UPDATE agent_runs SET status = 'errored', completed_at = ? WHERE status = 'running' AND started_at < ?`,
    args: [Date.now(), cutoff],
  });
  // Delete events for old non-running runs
  await client.execute({
    sql: `DELETE FROM agent_run_events WHERE run_id IN (
      SELECT id FROM agent_runs WHERE status != 'running' AND completed_at < ?
    )`,
    args: [cutoff],
  });
  await client.execute({
    sql: `DELETE FROM agent_runs WHERE status != 'running' AND completed_at < ?`,
    args: [cutoff],
  });
}
