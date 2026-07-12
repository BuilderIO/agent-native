import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

async function ensureCheckpointTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS agent_checkpoints (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          run_id TEXT,
          commit_sha TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          created_at ${intType()} NOT NULL
        )
      `;
      // Hot read paths: getCheckpointsByThread filters on thread_id and
      // sorts by created_at; getCheckpointByRunId filters on run_id.
      const threadIdxSql = `CREATE INDEX IF NOT EXISTS agent_checkpoints_thread_created_idx ON agent_checkpoints (thread_id, created_at)`;
      const runIdxSql = `CREATE INDEX IF NOT EXISTS agent_checkpoints_run_idx ON agent_checkpoints (run_id)`;

      if (isPostgres()) {
        // PG-guard: probe information_schema before issuing DDL to avoid ACCESS
        // EXCLUSIVE lock contention in fresh background-worker processes.
        await ensureTableExists("agent_checkpoints", createSql);
        await ensureIndexExists(
          "agent_checkpoints_thread_created_idx",
          threadIdxSql,
        );
        await ensureIndexExists("agent_checkpoints_run_idx", runIdxSql);
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      await client.execute(threadIdxSql);
      await client.execute(runIdxSql);
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function insertCheckpoint(
  id: string,
  threadId: string,
  runId: string | null,
  commitSha: string,
  message: string,
): Promise<void> {
  await ensureCheckpointTable();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_checkpoints (id, thread_id, run_id, commit_sha, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, threadId, runId, commitSha, message, Date.now()],
  });
}

export async function getCheckpointsByThread(threadId: string): Promise<
  Array<{
    id: string;
    threadId: string;
    runId: string | null;
    commitSha: string;
    message: string;
    createdAt: number;
  }>
> {
  await ensureCheckpointTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, run_id, commit_sha, message, created_at FROM agent_checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 200`,
    args: [threadId],
  });
  return (rows as any[]).map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    runId: r.run_id,
    commitSha: r.commit_sha,
    message: r.message,
    createdAt: r.created_at,
  }));
}

export async function getCheckpointById(id: string): Promise<{
  id: string;
  threadId: string;
  runId: string | null;
  commitSha: string;
  message: string;
  createdAt: number;
} | null> {
  await ensureCheckpointTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, run_id, commit_sha, message, created_at FROM agent_checkpoints WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    id: r.id,
    threadId: r.thread_id,
    runId: r.run_id,
    commitSha: r.commit_sha,
    message: r.message,
    createdAt: r.created_at,
  };
}

export async function getCheckpointByRunId(runId: string): Promise<{
  id: string;
  threadId: string;
  runId: string | null;
  commitSha: string;
  message: string;
  createdAt: number;
} | null> {
  await ensureCheckpointTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, run_id, commit_sha, message, created_at FROM agent_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    id: r.id,
    threadId: r.thread_id,
    runId: r.run_id,
    commitSha: r.commit_sha,
    message: r.message,
    createdAt: r.created_at,
  };
}

export async function cleanupOldCheckpoints(
  olderThanMs: number,
): Promise<void> {
  await ensureCheckpointTable();
  const client = getDbExec();
  const cutoff = Date.now() - olderThanMs;
  await client.execute({
    sql: `DELETE FROM agent_checkpoints WHERE created_at < ?`,
    args: [cutoff],
  });
}
