import crypto from "crypto";
import { getDbExec, isPostgres, intType } from "../db/client.js";
import type { Task, Message, TaskState, Artifact } from "./types.js";

let _initialized = false;

async function ensureTable(): Promise<void> {
  if (_initialized) return;
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
  _initialized = true;
}

function taskFromRow(row: any): Task {
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
  };
}

export async function createTask(
  message: Message,
  contextId?: string,
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
  };

  await client.execute({
    sql: `INSERT INTO a2a_tasks (id, context_id, status_state, status_timestamp, history, artifacts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      contextId ?? null,
      "submitted",
      timestamp,
      JSON.stringify([message]),
      "[]",
      now,
      now,
    ],
  });

  return task;
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
