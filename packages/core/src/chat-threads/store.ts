import { getDbExec, intType } from "../db/client.js";
import {
  mergeThreadDataForClientSave,
  normalizeThreadRepository,
} from "../agent/thread-data-builder.js";
import { emitChatThreadChange } from "./emitter.js";

let _initPromise: Promise<void> | undefined;

/**
 * Per-thread async mutex. Read-modify-write on the `thread_data` JSON blob
 * is not atomic at the DB level — two concurrent callers (e.g. the UI
 * persisting queued messages while `onRunComplete` appends agent output)
 * would both read the same row, each mutate it independently, and the
 * second write clobbers the first. Serializing on thread id inside this
 * process eliminates the race for the usual single-process deployment
 * while leaving straight reads and other thread-data-unrelated updates
 * untouched.
 *
 * Cross-process races are handled by `updateThreadData`, which performs a
 * compare-and-swap on `updated_at`, rereads the latest row on conflict, and
 * remerges message history before retrying.
 */
const _threadDataLocks = new Map<string, Promise<unknown>>();

export function withThreadDataLock<T>(
  threadId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = _threadDataLocks.get(threadId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  _threadDataLocks.set(threadId, next);
  // Use `.then(cleanup, cleanup)` (not `.finally`) so the rejection is
  // observed on this chained promise — otherwise any failure inside `fn`
  // triggers `unhandledRejection` on the discarded `finally()` return.
  // The caller still sees the rejection via `next`.
  const cleanup = () => {
    if (_threadDataLocks.get(threadId) === next) {
      _threadDataLocks.delete(threadId);
    }
  };
  next.then(cleanup, cleanup);
  return next as Promise<T>;
}

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

function deriveMessageCount(threadData: unknown, fallback: number): number {
  if (typeof threadData !== "string" || !threadData.trim()) return fallback;
  try {
    const repo = normalizeThreadRepository(JSON.parse(threadData));
    if (Array.isArray(repo.messages)) return repo.messages.length;
  } catch {
    // Keep the stored count if the JSON blob is malformed.
  }
  return fallback;
}

function rowToThread(r: Record<string, unknown>): ChatThread {
  const threadData = (r.thread_data as string) ?? "{}";
  const storedCount = Number(r.message_count);
  return {
    id: r.id as string,
    ownerEmail: r.owner_email as string,
    title: r.title as string,
    preview: r.preview as string,
    threadData,
    messageCount: deriveMessageCount(threadData, storedCount),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToSummary(r: Record<string, unknown>): ChatThreadSummary | null {
  const threadData = r.thread_data as string | undefined;
  const storedCount = Number(r.message_count);
  const messageCount = deriveMessageCount(threadData, storedCount);
  if (messageCount <= 0) return null;
  return {
    id: r.id as string,
    title: r.title as string,
    preview: r.preview as string,
    messageCount,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
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
  return rowToThread(rows[0]);
}

export async function forkThread(
  sourceId: string,
  ownerEmail: string,
  opts?: { id?: string },
): Promise<ChatThread | null> {
  const source = await getThread(sourceId);
  if (!source || source.ownerEmail !== ownerEmail) return null;
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = source.title ? `${source.title} (fork)` : "";
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      title,
      source.preview,
      source.threadData,
      source.messageCount,
      now,
      now,
    ],
  });
  return {
    id,
    ownerEmail,
    title,
    preview: source.preview,
    threadData: source.threadData,
    messageCount: source.messageCount,
    createdAt: now,
    updatedAt: now,
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
    sql: `SELECT id, title, preview, thread_data, message_count, created_at, updated_at FROM chat_threads WHERE owner_email = ? AND (message_count > 0 OR thread_data LIKE '%"messages"%') ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    args: [ownerEmail, limit, offset],
  });
  return rows
    .map((r) => rowToSummary(r))
    .filter((r): r is ChatThreadSummary => r !== null);
}

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export async function searchThreads(
  ownerEmail: string,
  query: string,
  limit = 50,
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const client = getDbExec();
  const pattern = `%${escapeLike(query)}%`;
  const { rows } = await client.execute({
    sql: `SELECT id, title, preview, thread_data, message_count, created_at, updated_at FROM chat_threads WHERE owner_email = ? AND (message_count > 0 OR thread_data LIKE '%"messages"%') AND (title LIKE ? OR preview LIKE ? OR thread_data LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
    args: [ownerEmail, pattern, pattern, pattern, limit],
  });
  return rows
    .map((r) => rowToSummary(r))
    .filter((r): r is ChatThreadSummary => r !== null);
}

export interface UpdateThreadDataOptions {
  preserveExistingQueuedMessages?: boolean;
  preserveExistingTopLevelKeys?: boolean;
  maxAttempts?: number;
}

function parseThreadData(value: string): any {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export async function updateThreadData(
  id: string,
  threadData: string,
  title: string,
  preview: string,
  messageCount: number,
  options: UpdateThreadDataOptions = {},
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const maxAttempts = options.maxAttempts ?? 5;
  let lastConflict = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await getThread(id);
    if (!current) return;

    let nextThreadData = threadData;
    let nextMessageCount = messageCount;
    try {
      const merged = mergeThreadDataForClientSave(
        parseThreadData(current.threadData),
        parseThreadData(threadData),
        {
          preserveExistingQueuedMessages:
            options.preserveExistingQueuedMessages ?? true,
          preserveExistingTopLevelKeys:
            options.preserveExistingTopLevelKeys ?? true,
        },
      );
      nextThreadData = JSON.stringify(merged);
      if (Array.isArray(merged.messages)) {
        nextMessageCount = merged.messages.length;
      }
    } catch {
      // Keep the caller's serialized value if either JSON blob is malformed.
    }

    const nextUpdatedAt = Math.max(Date.now(), current.updatedAt + 1);
    const result = await client.execute({
      sql: `UPDATE chat_threads SET thread_data = ?, title = ?, preview = ?, message_count = ?, updated_at = ? WHERE id = ? AND updated_at = ?`,
      args: [
        nextThreadData,
        title,
        preview,
        nextMessageCount,
        nextUpdatedAt,
        id,
        current.updatedAt,
      ],
    });

    if (result.rowsAffected > 0) {
      emitChatThreadChange(id);
      return;
    }

    lastConflict = true;
    await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
  }

  if (lastConflict) {
    throw new Error(
      `Failed to update chat thread ${id} after concurrent write conflicts.`,
    );
  }
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
  return withThreadDataLock(threadId, async () => {
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
  });
}

export interface QueuedMessage {
  id: string;
  text: string;
  images?: string[];
  references?: unknown[];
}

/**
 * Persist the user's queued (not-yet-sent) messages onto the thread.
 * Stored in thread_data JSON so it survives reloads without a schema
 * change. Safe to call often — the frontend debounces writes.
 */
export async function setThreadQueuedMessages(
  threadId: string,
  queuedMessages: QueuedMessage[],
): Promise<void> {
  return withThreadDataLock(threadId, async () => {
    const thread = await getThread(threadId);
    if (!thread) return;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(thread.threadData);
    } catch {}
    if (queuedMessages.length === 0) {
      delete data.queuedMessages;
    } else {
      data.queuedMessages = queuedMessages;
    }
    await updateThreadData(
      threadId,
      JSON.stringify(data),
      thread.title,
      thread.preview,
      thread.messageCount,
      { preserveExistingQueuedMessages: false },
    );
  });
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
