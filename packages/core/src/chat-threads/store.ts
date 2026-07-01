import crypto from "node:crypto";

import {
  mergeThreadDataForClientSave,
  normalizeThreadRepository,
  normalizeThreadTitle,
} from "../agent/thread-data-builder.js";
import { getDbExec, intType, isPostgres } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
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
const DEFAULT_THREAD_DATA_UPDATE_ATTEMPTS = 12;
const THREAD_DATA_CONFLICT_BACKOFF_MS = 25;

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
      const createSql = `
        CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          preview TEXT NOT NULL DEFAULT '',
          thread_data TEXT NOT NULL DEFAULT '{}',
          message_count ${intType()} NOT NULL DEFAULT 0,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          scope_type TEXT,
          scope_id TEXT,
          scope_label TEXT,
          pinned_at ${intType()},
          archived_at ${intType()}
        )
      `;

      if (isPostgres()) {
        // Hot path: the `chat_threads` table and its indexes are virtually
        // always already present in production. Issuing `CREATE TABLE`/
        // `CREATE INDEX` still takes a lock that, in a fresh background-worker
        // process behind a concurrent connection on the shared Neon DB, can
        // block ~indefinitely (ACCESS EXCLUSIVE for CREATE TABLE; a write-
        // blocking SHARE lock for CREATE INDEX). The ensure* wrappers probe
        // `information_schema`/`pg_indexes` first (plain reads, no lock) and
        // run DDL ONLY for what is actually missing, bounded by a transaction-
        // scoped `lock_timeout`. If a swallowed lock-timeout leaves the schema
        // still missing they RE-PROBE and THROW rather than letting init
        // memoize success against absent schema. `chat_threads` is the
        // unqualified name even though the table lives in `public`.
        await ensureTableExists("chat_threads", createSql);
        // Additive columns — guarded so the hot path (columns already present)
        // skips the ACCESS EXCLUSIVE ALTER entirely.
        for (const [col, type] of [
          ["scope_type", "TEXT"],
          ["scope_id", "TEXT"],
          ["scope_label", "TEXT"],
          ["pinned_at", intType()],
          ["archived_at", intType()],
        ] as const) {
          await ensureColumnExists(
            "chat_threads",
            col,
            `ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS ${col} ${type}`,
          );
        }
        // Widen millisecond-timestamp columns that older deployments created as
        // 32-bit `INTEGER`; on Postgres the `Date.now()` written on every turn
        // overflows int4. No-op once widened / on fresh BIGINT databases.
        await widenIntColumnsToBigInt("chat_threads", [
          "created_at",
          "updated_at",
          "pinned_at",
          "archived_at",
        ]);
        // Indexes for the hot read paths. Both the sidebar list and the
        // scoped/per-resource list filter on owner_email (and optionally
        // scope) and sort by updated_at. Probe pg_indexes first (no lock)
        // and skip the SHARE-locking CREATE INDEX when already present.
        await ensureIndexExists(
          "chat_threads_owner_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_owner_updated_idx ON chat_threads (owner_email, updated_at)`,
        );
        await ensureIndexExists(
          "chat_threads_scope_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_scope_updated_idx ON chat_threads (scope_type, scope_id, updated_at)`,
        );
        // One-time backfill of message_count for legacy rows written before
        // the column was maintained.
        await backfillLegacyMessageCounts(client);
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      // Additive migration for existing tables. Both SQLite and Postgres
      // accept `ALTER TABLE ADD COLUMN` and will raise when the column
      // already exists; the try/catch makes the call idempotent across
      // both dialects without requiring an information_schema probe.
      for (const [col, type] of [
        ["scope_type", "TEXT"],
        ["scope_id", "TEXT"],
        ["scope_label", "TEXT"],
        ["pinned_at", intType()],
        ["archived_at", intType()],
      ] as const) {
        try {
          await client.execute(
            `ALTER TABLE chat_threads ADD COLUMN ${col} ${type}`,
          );
        } catch {
          // Column already exists.
        }
      }
      // Widen millisecond-timestamp columns that older deployments created as
      // 32-bit `INTEGER`; on Postgres the `Date.now()` written on every turn
      // overflows int4. No-op once widened / on fresh BIGINT databases.
      await widenIntColumnsToBigInt("chat_threads", [
        "created_at",
        "updated_at",
        "pinned_at",
        "archived_at",
      ]);
      // Indexes for the hot read paths. Both the sidebar list and the
      // scoped/per-resource list filter on owner_email (and optionally
      // scope) and sort by updated_at. Keep these dialect-agnostic (no
      // DESC, partial, or PG-only syntax) so they apply identically on
      // SQLite and the configured Postgres. `IF NOT EXISTS` makes them
      // idempotent across restarts.
      for (const ddl of [
        `CREATE INDEX IF NOT EXISTS chat_threads_owner_updated_idx ON chat_threads (owner_email, updated_at)`,
        `CREATE INDEX IF NOT EXISTS chat_threads_scope_updated_idx ON chat_threads (scope_type, scope_id, updated_at)`,
      ]) {
        try {
          await client.execute(ddl);
        } catch {
          // Index already exists or the dialect rejected a duplicate.
        }
      }
      // One-time backfill of message_count for legacy rows written before
      // the column was maintained. The list/summary path now reads
      // message_count directly (instead of re-parsing the thread_data blob)
      // and filters on `message_count > 0`, so any legacy row that has
      // messages but a stale `message_count = 0` would otherwise vanish from
      // the sidebar. Recompute the count from thread_data and persist it so
      // the hot path can stay blob-free. Idempotent: only touches rows where
      // the count is still 0 but the blob clearly contains a messages array.
      await backfillLegacyMessageCounts(client);
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

/**
 * Recompute `message_count` from `thread_data` for legacy rows that still
 * have a stale `message_count = 0` despite carrying a messages array in the
 * blob. Without this, dropping the `thread_data` payload (and the
 * `OR thread_data LIKE '%"messages"%'` filter) from the list path would make
 * those rows disappear from the sidebar. Runs once at table bootstrap and is
 * idempotent — after the first pass no row matches the WHERE clause again.
 */
async function backfillLegacyMessageCounts(
  client: ReturnType<typeof getDbExec>,
): Promise<void> {
  const { rows } = await client.execute({
    sql: `SELECT id, thread_data, message_count FROM chat_threads WHERE message_count = 0 AND thread_data LIKE '%"messages"%'`,
    args: [],
  });
  for (const r of rows) {
    const count = deriveMessageCount(r.thread_data, 0);
    if (count <= 0) continue;
    await client.execute({
      sql: `UPDATE chat_threads SET message_count = ? WHERE id = ? AND message_count = 0`,
      args: [count, r.id as string],
    });
  }
}

function generateId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A resource the chat is bound to, e.g. `{ type: "deck", id: "deck-abc" }`.
 * The framework is opaque to the type string — each template chooses what
 * its primary resource is and the surface it scopes to (deck, design,
 * dashboard, etc.). `label` is a denormalized snapshot for display when
 * the resource isn't on hand at render time; the live template can
 * overwrite it via the next createThread call.
 */
export interface ChatThreadScope {
  type: string;
  id: string;
  label?: string;
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
  scope: ChatThreadScope | null;
  pinnedAt: number | null;
  archivedAt: number | null;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: ChatThreadScope | null;
  pinnedAt: number | null;
  archivedAt: number | null;
}

export interface ForkThreadSourceSnapshot {
  threadData: string;
  title?: string;
  preview?: string;
  messageCount?: number;
  scope?: ChatThreadScope | null;
}

function readScope(r: Record<string, unknown>): ChatThreadScope | null {
  const type = r.scope_type as string | null | undefined;
  const id = r.scope_id as string | null | undefined;
  if (!type || !id) return null;
  const label = r.scope_label as string | null | undefined;
  return label ? { type, id, label } : { type, id };
}

function readNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeForkSourceSnapshot(
  source: ForkThreadSourceSnapshot | null | undefined,
): {
  threadData: string;
  title: string;
  preview: string;
  messageCount: number;
  scope?: ChatThreadScope | null;
} | null {
  if (!source || typeof source.threadData !== "string") return null;
  const threadData = source.threadData.trim();
  if (!threadData) return null;

  let parsed: any;
  try {
    parsed = normalizeThreadRepository(JSON.parse(threadData));
  } catch {
    return null;
  }

  const repoMessageCount = Array.isArray(parsed.messages)
    ? parsed.messages.length
    : 0;
  if (repoMessageCount <= 0) return null;

  return {
    threadData: JSON.stringify(parsed),
    title: typeof source.title === "string" ? source.title : "",
    preview: typeof source.preview === "string" ? source.preview : "",
    messageCount: repoMessageCount,
    ...(Object.prototype.hasOwnProperty.call(source, "scope")
      ? { scope: source.scope ?? null }
      : {}),
  };
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
    scope: readScope(r),
    pinnedAt: readNullableNumber(r.pinned_at),
    archivedAt: readNullableNumber(r.archived_at),
  };
}

function rowToSummary(r: Record<string, unknown>): ChatThreadSummary | null {
  // The summary path never loads `thread_data`; the count comes from the
  // dedicated `message_count` column (maintained on write, backfilled for
  // legacy rows at bootstrap). Empty threads are filtered out of the list.
  const messageCount = Number(r.message_count);
  if (!Number.isFinite(messageCount) || messageCount <= 0) return null;
  return {
    id: r.id as string,
    title: r.title as string,
    preview: r.preview as string,
    messageCount,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    scope: readScope(r),
    pinnedAt: readNullableNumber(r.pinned_at),
    archivedAt: readNullableNumber(r.archived_at),
  };
}

export async function createThread(
  ownerEmail: string,
  opts?: { id?: string; title?: string; scope?: ChatThreadScope | null },
): Promise<ChatThread> {
  await ensureTable();
  const client = getDbExec();
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = opts?.title ?? "";
  const scope = opts?.scope ?? null;

  await client.execute({
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label) VALUES (?, ?, ?, '', '{}', 0, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      title,
      now,
      now,
      scope?.type ?? null,
      scope?.id ?? null,
      scope?.label ?? null,
    ],
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
    scope,
    pinnedAt: null,
    archivedAt: null,
  };
}

const THREAD_COLUMNS = `id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at`;
// The list/summary path deliberately omits `thread_data`: it is the full
// message-history JSON blob and selecting it for every row turns "open the
// sidebar" into "download every conversation". The summary derives nothing
// from the blob anymore — preview and message_count are dedicated columns
// (message_count is maintained on write and backfilled for legacy rows at
// bootstrap). The detail path (`THREAD_COLUMNS` / `getThread`) still returns
// the full blob.
const SUMMARY_COLUMNS = `id, title, preview, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at`;

export async function getThread(id: string): Promise<ChatThread | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToThread(rows[0]);
}

export async function forkThread(
  sourceId: string,
  ownerEmail: string,
  opts?: { id?: string; source?: ForkThreadSourceSnapshot | null },
): Promise<ChatThread | null> {
  const snapshot = normalizeForkSourceSnapshot(opts?.source);
  let source = await getThread(sourceId);
  if (!source) {
    if (snapshot) {
      try {
        await createThread(ownerEmail, {
          id: sourceId,
          title: snapshot.title,
          scope: snapshot.scope ?? null,
        });
      } catch {
        // The agent run may have created the row while the user clicked Fork.
      }
      const created = await getThread(sourceId);
      if (created?.ownerEmail === ownerEmail) {
        await updateThreadData(
          sourceId,
          snapshot.threadData,
          snapshot.title || created.title,
          snapshot.preview || created.preview,
          snapshot.messageCount,
        );
        if (Object.prototype.hasOwnProperty.call(snapshot, "scope")) {
          await setThreadScope(sourceId, snapshot.scope ?? null);
        }
        source = await getThread(sourceId);
      }
    }
  } else if (
    snapshot &&
    source.ownerEmail === ownerEmail &&
    snapshot.messageCount > source.messageCount
  ) {
    // The source row exists but the in-memory snapshot is fresher — the agent
    // run flushed an older state to SQL, but the tab has additional unflushed
    // messages. Overlay the snapshot before cloning so the fork captures the
    // latest user-visible content. Guard with messageCount > stored to avoid
    // clobbering a fresher persisted row with a stale snapshot from another
    // tab.
    source = {
      ...source,
      threadData: snapshot.threadData,
      title: snapshot.title || source.title,
      preview: snapshot.preview || source.preview,
      messageCount: snapshot.messageCount,
    };
  }
  if (!source || source.ownerEmail !== ownerEmail) return null;
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = source.title ? `${source.title} (fork)` : "";
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      title,
      source.preview,
      source.threadData,
      source.messageCount,
      now,
      now,
      source.scope?.type ?? null,
      source.scope?.id ?? null,
      source.scope?.label ?? null,
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
    scope: source.scope,
    pinnedAt: null,
    archivedAt: null,
  };
}

export interface ListThreadsOptions {
  limit?: number;
  offset?: number;
  /**
   * Filter for chats bound to a specific resource. The default (undefined)
   * returns every thread the user owns. `{ type: "deck", id: "abc" }`
   * returns only that resource's threads. `{ type: "deck", id: null }` is
   * NOT supported — pass `unscopedOnly: true` to get only general chats.
   */
  scope?: { type: string; id: string };
  /** When true, returns only threads with no scope (general chats). */
  unscopedOnly?: boolean;
}

export async function listThreads(
  ownerEmail: string,
  options: ListThreadsOptions | number = {},
  legacyOffset?: number,
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  // Back-compat shim: previous signature was (owner, limit, offset).
  const opts: ListThreadsOptions =
    typeof options === "number"
      ? { limit: options, offset: legacyOffset ?? 0 }
      : options;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const client = getDbExec();
  // `message_count > 0` is the authoritative "has messages" signal: it is
  // maintained on every write and backfilled for legacy rows at bootstrap,
  // so the old `OR thread_data LIKE '%"messages"%'` substring scan over the
  // full blob is no longer needed here.
  const filters: string[] = [`owner_email = ?`, `message_count > 0`];
  const args: (string | number)[] = [ownerEmail];
  if (opts.scope) {
    filters.push(`scope_type = ? AND scope_id = ?`);
    args.push(opts.scope.type, opts.scope.id);
  } else if (opts.unscopedOnly) {
    filters.push(`scope_type IS NULL`);
  }
  args.push(limit, offset);
  const { rows } = await client.execute({
    sql: `SELECT ${SUMMARY_COLUMNS} FROM chat_threads WHERE ${filters.join(" AND ")} ORDER BY CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END, pinned_at DESC, updated_at DESC LIMIT ? OFFSET ?`,
    args,
  });
  return rows
    .map((r) => rowToSummary(r))
    .filter((r): r is ChatThreadSummary => r !== null);
}

function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (match) => `!${match}`);
}

export async function searchThreads(
  ownerEmail: string,
  query: string,
  limit = 50,
  options: { scope?: { type: string; id: string } } = {},
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const client = getDbExec();
  const pattern = `%${escapeLike(query)}%`;
  // The count-guard uses the maintained/backfilled `message_count` column
  // (same as listThreads). The content match still scans `thread_data` —
  // search legitimately needs to look inside message history.
  const filters: string[] = [
    `owner_email = ?`,
    `message_count > 0`,
    `(title LIKE ? ESCAPE '!' OR preview LIKE ? ESCAPE '!' OR thread_data LIKE ? ESCAPE '!')`,
  ];
  const args: (string | number)[] = [ownerEmail, pattern, pattern, pattern];
  if (options.scope) {
    filters.push(`scope_type = ? AND scope_id = ?`);
    args.push(options.scope.type, options.scope.id);
  }
  args.push(limit);
  const { rows } = await client.execute({
    sql: `SELECT ${SUMMARY_COLUMNS} FROM chat_threads WHERE ${filters.join(" AND ")} ORDER BY CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END, pinned_at DESC, updated_at DESC LIMIT ?`,
    args,
  });
  return rows
    .map((r) => rowToSummary(r))
    .filter((r): r is ChatThreadSummary => r !== null);
}

/**
 * Detach or rebind a chat's scope. Used by the UI's "Detach from <resource>"
 * action and by templates that need to retag a chat after a rename. Pass
 * `null` to clear the scope (chat becomes general).
 */
export async function setThreadScope(
  id: string,
  scope: ChatThreadScope | null,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE chat_threads SET scope_type = ?, scope_id = ?, scope_label = ?, updated_at = ? WHERE id = ?`,
    args: [
      scope?.type ?? null,
      scope?.id ?? null,
      scope?.label ?? null,
      Math.max(Date.now(), 1),
      id,
    ],
  });
  emitChatThreadChange(id);
}

export async function renameThread(
  id: string,
  title: string,
  options: { ownerEmail?: string } = {},
): Promise<boolean> {
  const nextTitle = normalizeThreadTitle(title);
  if (!nextTitle) return false;

  return await withThreadDataLock(id, async () => {
    const thread = await getThread(id);
    if (!thread) return false;
    if (options.ownerEmail && thread.ownerEmail !== options.ownerEmail) {
      return false;
    }

    const repo = parseThreadData(thread.threadData);
    repo._titleOverride = nextTitle;
    await updateThreadData(
      id,
      JSON.stringify(repo),
      nextTitle,
      thread.preview,
      thread.messageCount,
    );
    return true;
  });
}

export async function setThreadPinned(
  id: string,
  pinned: boolean,
  options: { ownerEmail?: string } = {},
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Math.max(Date.now(), 1);
  const args: (string | number | null)[] = [pinned ? now : null, id];
  let ownerFilter = "";
  if (options.ownerEmail) {
    ownerFilter = " AND owner_email = ?";
    args.push(options.ownerEmail);
  }
  const result = await client.execute({
    sql: `UPDATE chat_threads SET pinned_at = ? WHERE id = ?${ownerFilter}`,
    args,
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return true;
  }
  return false;
}

export async function setThreadArchived(
  id: string,
  archived: boolean,
  options: { ownerEmail?: string } = {},
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Math.max(Date.now(), 1);
  const args: (string | number | null)[] = [archived ? now : null, id];
  let ownerFilter = "";
  if (options.ownerEmail) {
    ownerFilter = " AND owner_email = ?";
    args.push(options.ownerEmail);
  }
  const result = await client.execute({
    sql: `UPDATE chat_threads SET archived_at = ? WHERE id = ?${ownerFilter}`,
    args,
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return true;
  }
  return false;
}

export interface UpdateThreadDataOptions {
  preserveExistingQueuedMessages?: boolean;
  preserveExistingTopLevelKeys?: boolean;
  maxAttempts?: number;
  ignoreConflicts?: boolean;
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
  const maxAttempts =
    options.maxAttempts ?? DEFAULT_THREAD_DATA_UPDATE_ATTEMPTS;
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
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(250, THREAD_DATA_CONFLICT_BACKOFF_MS * (attempt + 1)),
        ),
      );
    }
  }

  if (lastConflict) {
    if (options.ignoreConflicts) return;
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

const THREAD_SHARE_DATA_KEY = "_share";

interface StoredThreadShare {
  tokenHash?: string;
  createdAt?: number;
  updatedAt?: number;
  revokedAt?: number | null;
}

export interface ChatThreadShareState {
  enabled: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  revokedAt: number | null;
}

export interface ChatThreadShareLink extends ChatThreadShareState {
  enabled: true;
  token: string;
}

function generateShareToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashThreadShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeThreadShare(value: unknown): StoredThreadShare | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const tokenHash =
    typeof r.tokenHash === "string" && /^[a-f0-9]{64}$/i.test(r.tokenHash)
      ? r.tokenHash.toLowerCase()
      : undefined;
  const createdAt = normalizeTimestamp(r.createdAt);
  const updatedAt = normalizeTimestamp(r.updatedAt);
  const revokedAt = normalizeTimestamp(r.revokedAt);
  if (!tokenHash && !createdAt && !updatedAt && !revokedAt) return null;
  return {
    ...(tokenHash ? { tokenHash } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(revokedAt ? { revokedAt } : {}),
  };
}

function normalizeTimestamp(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function shareStateFromStored(
  stored: StoredThreadShare | null,
): ChatThreadShareState {
  const revokedAt = stored?.revokedAt ?? null;
  return {
    enabled: Boolean(stored?.tokenHash && !revokedAt),
    createdAt: stored?.createdAt ?? null,
    updatedAt: stored?.updatedAt ?? null,
    revokedAt,
  };
}

function readStoredThreadShare(threadData: string): StoredThreadShare | null {
  const data = parseThreadData(threadData);
  return normalizeThreadShare(data[THREAD_SHARE_DATA_KEY]);
}

export async function getThreadShareState(
  threadId: string,
  options: { ownerEmail?: string } = {},
): Promise<ChatThreadShareState | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;
  if (options.ownerEmail && thread.ownerEmail !== options.ownerEmail) {
    return null;
  }
  return shareStateFromStored(readStoredThreadShare(thread.threadData));
}

export async function createThreadShareLink(
  threadId: string,
  options: { ownerEmail?: string } = {},
): Promise<ChatThreadShareLink | null> {
  return withThreadDataLock(threadId, async () => {
    const thread = await getThread(threadId);
    if (!thread) return null;
    if (options.ownerEmail && thread.ownerEmail !== options.ownerEmail) {
      return null;
    }

    const now = Date.now();
    const token = generateShareToken();
    const data = parseThreadData(thread.threadData);
    const existing = normalizeThreadShare(data[THREAD_SHARE_DATA_KEY]);
    data[THREAD_SHARE_DATA_KEY] = {
      tokenHash: hashThreadShareToken(token),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
    } satisfies StoredThreadShare;

    await updateThreadData(
      threadId,
      JSON.stringify(data),
      thread.title,
      thread.preview,
      thread.messageCount,
    );

    return {
      enabled: true,
      token,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
    };
  });
}

export async function revokeThreadShareLink(
  threadId: string,
  options: { ownerEmail?: string } = {},
): Promise<ChatThreadShareState | null> {
  return withThreadDataLock(threadId, async () => {
    const thread = await getThread(threadId);
    if (!thread) return null;
    if (options.ownerEmail && thread.ownerEmail !== options.ownerEmail) {
      return null;
    }

    const now = Date.now();
    const data = parseThreadData(thread.threadData);
    const existing = normalizeThreadShare(data[THREAD_SHARE_DATA_KEY]);
    data[THREAD_SHARE_DATA_KEY] = {
      ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
      updatedAt: now,
      revokedAt: now,
    } satisfies StoredThreadShare;

    await updateThreadData(
      threadId,
      JSON.stringify(data),
      thread.title,
      thread.preview,
      thread.messageCount,
    );

    return {
      enabled: false,
      createdAt: existing?.createdAt ?? null,
      updatedAt: now,
      revokedAt: now,
    };
  });
}

export async function getThreadByShareToken(
  token: string,
): Promise<ChatThread | null> {
  const cleanToken = token.trim();
  if (!cleanToken || cleanToken.length < 16) return null;
  await ensureTable();
  const tokenHash = hashThreadShareToken(cleanToken);
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE thread_data LIKE ? LIMIT 10`,
    args: [`%${tokenHash}%`],
  });
  for (const row of rows) {
    const thread = rowToThread(row);
    const stored = readStoredThreadShare(thread.threadData);
    if (!stored?.tokenHash || stored.revokedAt) continue;
    if (stored.tokenHash !== tokenHash) continue;
    return thread;
  }
  return null;
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
