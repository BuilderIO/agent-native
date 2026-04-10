import { getDbExec, isPostgres, intType } from "../db/client.js";
import { emitChatThreadChange } from "./emitter.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          preview TEXT NOT NULL DEFAULT '',
          thread_data TEXT NOT NULL DEFAULT '{}',
          message_count ${intType()} NOT NULL DEFAULT 0,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL
        )
      `);
    })();
  }
  return _initPromise;
}

function generateId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ChatThread {
  id: string;
  ownerEmail: string;
  title: string;
  preview: string;
  threadData: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export async function createThread(
  ownerEmail: string,
  opts?: { id?: string; title?: string },
): Promise<ChatThread> {
  await ensureTable();
  const client = getDbExec();
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = opts?.title ?? "";

  await client.execute({
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at) VALUES (?, ?, ?, '', '{}', 0, ?, ?)`,
    args: [id, ownerEmail, title, now, now],
  });

  return {
    id,
    ownerEmail,
    title,
    preview: "",
    threadData: "{}",
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getThread(id: string): Promise<ChatThread | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, owner_email, title, preview, thread_data, message_count, created_at, updated_at FROM chat_threads WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id as string,
    ownerEmail: r.owner_email as string,
    title: r.title as string,
    preview: r.preview as string,
    threadData: r.thread_data as string,
    messageCount: Number(r.message_count),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listThreads(
  ownerEmail: string,
  limit = 50,
  offset = 0,
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, title, preview, message_count, created_at, updated_at FROM chat_threads WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    args: [ownerEmail, limit, offset],
  });
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    preview: r.preview as string,
    messageCount: Number(r.message_count),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export async function searchThreads(
  ownerEmail: string,
  query: string,
  limit = 50,
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const client = getDbExec();
  const pattern = `%${query}%`;
  const { rows } = await client.execute({
    sql: `SELECT id, title, preview, message_count, created_at, updated_at FROM chat_threads WHERE owner_email = ? AND (title LIKE ? OR preview LIKE ? OR thread_data LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
    args: [ownerEmail, pattern, pattern, pattern, limit],
  });
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    preview: r.preview as string,
    messageCount: Number(r.message_count),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export async function updateThreadData(
  id: string,
  threadData: string,
  title: string,
  preview: string,
  messageCount: number,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE chat_threads SET thread_data = ?, title = ?, preview = ?, message_count = ?, updated_at = ? WHERE id = ?`,
    args: [threadData, title, preview, messageCount, Date.now(), id],
  });
  emitChatThreadChange(id);
}

export interface ThreadEngineMeta {
  engineName: string;
  model: string;
}

/**
 * Read the engine pinned to a thread (stored in thread_data JSON).
 * Returns null if no engine is pinned.
 */
export async function getThreadEngineMeta(
  threadId: string,
): Promise<ThreadEngineMeta | null> {
  const thread = await getThread(threadId);
  if (!thread?.threadData) return null;
  try {
    const data = JSON.parse(thread.threadData);
    if (data.engineMeta?.engineName) return data.engineMeta as ThreadEngineMeta;
  } catch {}
  return null;
}

/**
 * Pin an engine to a thread by storing engineMeta in thread_data JSON.
 * Does not change messages, title, or preview.
 */
export async function setThreadEngineMeta(
  threadId: string,
  meta: ThreadEngineMeta,
): Promise<void> {
  const thread = await getThread(threadId);
  if (!thread) return;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(thread.threadData);
  } catch {}
  data.engineMeta = meta;
  await updateThreadData(
    threadId,
    JSON.stringify(data),
    thread.title,
    thread.preview,
    thread.messageCount,
  );
}

export async function deleteThread(id: string): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `DELETE FROM chat_threads WHERE id = ?`,
    args: [id],
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return true;
  }
  return false;
}
