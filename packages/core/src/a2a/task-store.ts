import crypto from "crypto";
import { getDbExec, isPostgres, intType } from "../db/client.js";
import type { Task, Message, TaskState, Artifact } from "./types.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS a2a_tasks (
          id TEXT PRIMARY KEY,
          context_id TEXT,
          status_state TEXT NOT NULL DEFAULT 'submitted',
          status_message TEXT,
          status_timestamp TEXT NOT NULL,
          history TEXT NOT NULL DEFAULT '[]',
          artifacts TEXT NOT NULL DEFAULT '[]',
          metadata TEXT,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL
        )
      `);
      // Additive migration: owner_email column. Bound to the JWT-verified
      // caller at task-creation time so handleGet / handleCancel can reject
      // mismatched callers (the IDOR class fixed in PR #369). Existing rows
      // have NULL owner_email and remain accessible to legacy callers via
      // the legacy-token apiKeyEnv path; new rows are scoped from this point
      // forward.
      try {
        await client.execute(
          `ALTER TABLE a2a_tasks ADD COLUMN owner_email TEXT`,
        );
      } catch {
        // Column already exists — expected on every restart after first run.
      }
    })();
  }
  return _initPromise;
}

function taskFromRow(row: any): Task & { ownerEmail?: string | null } {
  return {
    id: row.id as string,
    contextId: (row.context_id as string) || undefined,
    status: {
      state: row.status_state as TaskState,
      message: row.status_message
        ? JSON.parse(row.status_message as string)
        : undefined,
      timestamp: row.status_timestamp as string,
    },
    history: JSON.parse(row.history as string),
    artifacts: JSON.parse(row.artifacts as string),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    ownerEmail: (row.owner_email as string | null) ?? null,
  };
}

export async function createTask(
  message: Message,
  contextId?: string,
  metadata?: Record<string, unknown>,
  ownerEmail?: string | null,
): Promise<Task> {
  await ensureTable();
  const client = getDbExec();
  const id = crypto.randomUUID();
  const now = Date.now();
  const timestamp = new Date().toISOString();

  const task: Task = {
    id,
    contextId,
    status: { state: "submitted", timestamp },
    history: [message],
    artifacts: [],
    metadata,
  };

  await client.execute({
    sql: `INSERT INTO a2a_tasks (id, context_id, status_state, status_timestamp, history, artifacts, metadata, owner_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      contextId ?? null,
      "submitted",
      timestamp,
      JSON.stringify([message]),
      "[]",
      metadata ? JSON.stringify(metadata) : null,
      ownerEmail ?? null,
      now,
      now,
    ],
  });

  return task;
}

/**
 * Fetch the verified owner email recorded against a task at creation time.
 * Returns null when the task has no owner (legacy rows or unauthenticated
 * deployments) or when the task is missing.
 *
 * Used by `handleGet` / `handleCancel` to reject IDOR access — the JWT-
 * verified caller's email must match `owner_email` to read or cancel.
 */
export async function getTaskOwner(id: string): Promise<string | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT owner_email FROM a2a_tasks WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  const ownerEmail = (rows[0] as any).owner_email;
  return typeof ownerEmail === "string" && ownerEmail ? ownerEmail : null;
}

/**
 * Atomically claim a task for processing. Only succeeds when the task is in
 * state 'submitted' or 'working' — flipping it to 'processing' so concurrent
 * processors can't pick it up twice. Returns the task if claimed, null if it
 * was already claimed/completed/missing.
 *
 * Used by the cross-platform async processor (`_process-task` route) to avoid
 * duplicate handler runs when retries fire.
 */
export async function claimA2ATaskForProcessing(
  id: string,
): Promise<Task | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const timestamp = new Date().toISOString();

  const result = await client.execute({
    sql: `UPDATE a2a_tasks
            SET status_state = 'processing',
                status_timestamp = ?,
                updated_at = ?
          WHERE id = ?
            AND status_state IN ('submitted', 'working')`,
    args: [timestamp, now, id],
  });
  const affected = (result as any)?.rowsAffected ?? (result as any)?.rowCount;
  if (affected === 0) return null;

  const { rows } = await client.execute({
    sql: `SELECT * FROM a2a_tasks WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return taskFromRow(rows[0]);
}

export async function getTask(id: string): Promise<Task | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM a2a_tasks WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return taskFromRow(rows[0]);
}

export async function updateTask(
  id: string,
  update: {
    state?: TaskState;
    message?: Message;
    artifacts?: Artifact[];
  },
): Promise<Task | null> {
  await ensureTable();
  const client = getDbExec();

  // Read current task
  const { rows } = await client.execute({
    sql: `SELECT * FROM a2a_tasks WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;

  const task = taskFromRow(rows[0]);
  const now = Date.now();

  if (update.state) {
    task.status = {
      state: update.state,
      message: update.message ?? task.status.message,
      timestamp: new Date().toISOString(),
    };
  }

  if (update.message && task.history) {
    task.history.push(update.message);
  }

  if (update.artifacts) {
    task.artifacts = [...(task.artifacts ?? []), ...update.artifacts];
  }

  await client.execute({
    sql: `UPDATE a2a_tasks SET status_state = ?, status_message = ?, status_timestamp = ?, history = ?, artifacts = ?, updated_at = ? WHERE id = ?`,
    args: [
      task.status.state,
      task.status.message ? JSON.stringify(task.status.message) : null,
      task.status.timestamp,
      JSON.stringify(task.history),
      JSON.stringify(task.artifacts),
      now,
      id,
    ],
  });

  return task;
}

export async function listTasks(contextId?: string): Promise<Task[]> {
  await ensureTable();
  const client = getDbExec();

  if (contextId) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM a2a_tasks WHERE context_id = ? ORDER BY created_at DESC`,
      args: [contextId],
    });
    return rows.map(taskFromRow);
  }

  const { rows } = await client.execute(
    `SELECT * FROM a2a_tasks ORDER BY created_at DESC`,
  );
  return rows.map(taskFromRow);
}
