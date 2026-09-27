import crypto from "node:crypto";

import {
  mergeThreadDataForClientSave,
  normalizeThreadRepository,
  normalizeThreadTitle,
} from "../agent/thread-data-builder.js";
import { getDbExec } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { getRequestOrgId } from "../server/request-context.js";
import { resolveAccess, type AccessContext } from "../sharing/access.js";
import { registerShareableResource } from "../sharing/registry.js";
import { roleSatisfies, type ShareRole } from "../sharing/schema.js";
import { emitChatThreadChange } from "./emitter.js";
import {
  chatThreads,
  chatThreadShares,
  CHAT_THREAD_SHARES_CREATE_SQL,
  CHAT_THREAD_SHARES_RESOURCE_INDEX_SQL,
} from "./schema.js";

let _initPromise: Promise<void> | undefined;

const _threadDataLocks = new Map<string, Promise<unknown>>();
const DEFAULT_THREAD_DATA_UPDATE_ATTEMPTS = 12;
const THREAD_DATA_CONFLICT_BACKOFF_MS = 25;
const getChatThreadsDb = createGetDb({ chatThreads, chatThreadShares });

export function withThreadDataLock<T>(
  threadId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = _threadDataLocks.get(threadId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  _threadDataLocks.set(threadId, next);
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
      const createSql = `
        CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          preview TEXT NOT NULL DEFAULT '',
          thread_data TEXT NOT NULL DEFAULT '{}',
          message_count BIGINT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          scope_type TEXT,
          scope_id TEXT,
          scope_label TEXT,
          pinned_at BIGINT,
          archived_at BIGINT,
          share_token_hash TEXT,
          source_platform TEXT,
          source_app_id TEXT,
          source_url TEXT,
          org_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private'
        )
      `;

      {
        await ensureTableExists("chat_threads", createSql);
        for (const [col, type] of [
          ["scope_type", "TEXT"],
          ["scope_id", "TEXT"],
          ["scope_label", "TEXT"],
          ["pinned_at", "BIGINT"],
          ["archived_at", "BIGINT"],
          ["share_token_hash", "TEXT"],
          ["source_platform", "TEXT"],
          ["source_app_id", "TEXT"],
          ["source_url", "TEXT"],
          ["org_id", "TEXT"],
          ["visibility", "TEXT NOT NULL DEFAULT 'private'"],
        ] as const) {
          await ensureColumnExists(
            "chat_threads",
            col,
            `ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS ${col} ${type}`,
          );
        }
        await ensureTableExists(
          "chat_thread_shares",
          CHAT_THREAD_SHARES_CREATE_SQL,
        );
        await widenIntColumnsToBigInt("chat_threads", [
          "created_at",
          "updated_at",
          "pinned_at",
          "archived_at",
        ]);
        await ensureIndexExists(
          "chat_threads_owner_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_owner_updated_idx ON chat_threads (owner_email, updated_at)`,
        );
        await ensureIndexExists(
          "chat_threads_owner_lower_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_owner_lower_updated_idx ON chat_threads (LOWER(owner_email), updated_at)`,
        );
        await ensureIndexExists(
          "chat_thread_shares_principal_lower_idx",
          `CREATE INDEX IF NOT EXISTS chat_thread_shares_principal_lower_idx ON chat_thread_shares (resource_id, principal_type, LOWER(principal_id))`,
        );
        await ensureIndexExists(
          "chat_threads_scope_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_scope_updated_idx ON chat_threads (scope_type, scope_id, updated_at)`,
        );
        await ensureIndexExists(
          "chat_threads_source_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_source_updated_idx ON chat_threads (owner_email, source_app_id, updated_at)`,
        );
        await ensureIndexExists(
          "chat_threads_share_token_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_share_token_idx ON chat_threads (share_token_hash)`,
        );
        await ensureIndexExists(
          "chat_thread_shares_resource_idx",
          CHAT_THREAD_SHARES_RESOURCE_INDEX_SQL,
        );
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export async function repairLegacyChatThreadMessageCounts(
  options: {
    batchSize?: number;
  } = {},
): Promise<{ scanned: number; updated: number }> {
  await ensureTable();
  const client = getDbExec();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 1_000));
  let afterId = "";
  let scanned = 0;
  let updated = 0;
  while (true) {
    const { rows } = await client.execute({
      sql: `SELECT id, thread_data, message_count FROM chat_threads
            WHERE message_count = 0
              AND thread_data LIKE '%"messages"%'
              AND id > ?
            ORDER BY id
            LIMIT ?`,
      args: [afterId, batchSize],
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = String(row.id);
      scanned++;
      const count = deriveMessageCount(row.thread_data, 0);
      if (count <= 0) continue;
      const result = await client.execute({
        sql: `UPDATE chat_threads SET message_count = ? WHERE id = ? AND message_count = 0`,
        args: [count, afterId],
      });
      if (result.rowsAffected > 0) updated++;
    }
    if (rows.length < batchSize) break;
  }
  return { scanned, updated };
}

function generateId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ChatThreadScope {
  type: string;
  id: string;
  label?: string;
}

export function isAppOwnedChatScope(scope?: ChatThreadScope | null): boolean {
  return scope?.type === "workspace-app" || scope?.type === "desktop-app";
}

/**
 * A scoped rail may claim a legacy unscoped thread on its first write, but
 * once a thread has a scope, a non-null incoming scope must match it. App-
 * owned threads additionally require a scope on every subsequent write.
 */
export function threadScopeMismatch(
  existing?: ChatThreadScope | null,
  incoming?: ChatThreadScope | null,
): boolean {
  if (!existing) return false;
  if (!incoming) return isAppOwnedChatScope(existing);
  return existing.type !== incoming.type || existing.id !== incoming.id;
}

export interface ChatThreadSource {
  platform?: string | null;
  appId?: string | null;
  url?: string | null;
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
  source: ChatThreadSource | null;
  orgId: string | null;
  visibility: "private" | "org" | "public";
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
  source: ChatThreadSource | null;
  orgId: string | null;
  visibility: "private" | "org" | "public";
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

function readSource(r: Record<string, unknown>): ChatThreadSource | null {
  const platform =
    typeof r.source_platform === "string" && r.source_platform.trim()
      ? r.source_platform.trim()
      : null;
  const appId =
    typeof r.source_app_id === "string" && r.source_app_id.trim()
      ? r.source_app_id.trim()
      : null;
  const url =
    typeof r.source_url === "string" && r.source_url.trim()
      ? r.source_url.trim()
      : null;
  if (!platform && !appId && !url) return null;
  return {
    ...(platform ? { platform } : {}),
    ...(appId ? { appId } : {}),
    ...(url ? { url } : {}),
  };
}

function readNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readVisibility(value: unknown): "private" | "org" | "public" {
  return value === "org" || value === "public" ? value : "private";
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
    source: readSource(r),
    orgId: (r.org_id as string | null | undefined) ?? null,
    visibility: readVisibility(r.visibility),
  };
}

function rowToSummary(r: Record<string, unknown>): ChatThreadSummary | null {
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
    source: readSource(r),
    orgId: (r.org_id as string | null | undefined) ?? null,
    visibility: readVisibility(r.visibility),
  };
}

export async function createThread(
  ownerEmail: string,
  opts?: {
    id?: string;
    title?: string;
    scope?: ChatThreadScope | null;
    source?: ChatThreadSource | null;
    orgId?: string | null;
  },
): Promise<ChatThread> {
  await ensureTable();
  const client = getDbExec();
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = opts?.title ?? "";
  const scope = opts?.scope ?? null;
  const source = opts?.source ?? null;
  const orgId = opts?.orgId ?? getRequestOrgId() ?? null;

  await client.execute({
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, source_platform, source_app_id, source_url, org_id, visibility) VALUES (?, ?, ?, '', '{}', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
    args: [
      id,
      ownerEmail,
      title,
      now,
      now,
      scope?.type ?? null,
      scope?.id ?? null,
      scope?.label ?? null,
      source?.platform ?? null,
      source?.appId ?? null,
      source?.url ?? null,
      orgId,
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
    source,
    orgId,
    visibility: "private",
  };
}

const THREAD_COLUMNS = `id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at, source_platform, source_app_id, source_url, org_id, visibility`;
const SUMMARY_COLUMNS = `id, title, preview, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at, source_platform, source_app_id, source_url, org_id, visibility`;

export function registerChatThreadsShareable(): void {
  registerShareableResource({
    type: "chat_thread",
    resourceTable: chatThreads,
    sharesTable: chatThreadShares,
    displayName: "Chat",
    titleColumn: "title",
    getResourcePath: (thread) =>
      `/?thread=${encodeURIComponent(String(thread.id ?? ""))}`,
    getDb: () => getChatThreadsDb(),
    allowPublic: false,
    ownerAccessIgnoresOrg: true,
  });
}

export async function ensureChatThreadTables(): Promise<void> {
  await ensureTable();
}

export async function resolveThreadAccess(
  userEmail: string | null | undefined,
  threadId: string | null | undefined,
  minRole: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
): Promise<ChatThread | null> {
  if (!userEmail || !threadId) return null;
  const access = await resolveAccess(
    "chat_thread",
    threadId,
    { userEmail, orgId: ctx.orgId },
    { skipResourceBody: true },
  );
  if (!access || !roleSatisfies(access.role, minRole)) return null;
  return await getThread(threadId);
}

export async function resolveThreadsAccess(
  userEmail: string | null | undefined,
  threadIds: readonly string[],
  ctx: Pick<AccessContext, "orgId"> = {},
): Promise<Map<string, ChatThread>> {
  const ids = [...new Set(threadIds.filter(Boolean))];
  const threads = new Map<string, ChatThread>();
  if (!userEmail || ids.length === 0) return threads;

  await ensureTable();
  const access = chatThreadAccessSql(userEmail, ctx.orgId);
  const client = getDbExec();
  const placeholders = ids.map(() => "?").join(", ");
  const { rows } = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE id IN (${placeholders}) AND ${access.sql}`,
    args: [...ids, ...access.args],
  });
  for (const row of rows) {
    const thread = rowToThread(row);
    threads.set(thread.id, thread);
  }
  return threads;
}

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

export async function setThreadSourceIfMissing(
  id: string,
  source: ChatThreadSource | null | undefined,
): Promise<boolean> {
  if (!source || (!source.platform && !source.appId && !source.url)) {
    return false;
  }
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE chat_threads SET source_platform = COALESCE(source_platform, ?), source_app_id = COALESCE(source_app_id, ?), source_url = COALESCE(source_url, ?) WHERE id = ?`,
    args: [
      source.platform ?? null,
      source.appId ?? null,
      source.url ?? null,
      id,
    ],
  });
  return result.rowsAffected > 0;
}

export async function forkThread(
  sourceId: string,
  ownerEmail: string,
  opts?: {
    id?: string;
    source?: ForkThreadSourceSnapshot | null;
    sourceAccessGranted?: boolean;
  },
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
    source = {
      ...source,
      threadData: snapshot.threadData,
      title: snapshot.title || source.title,
      preview: snapshot.preview || source.preview,
      messageCount: snapshot.messageCount,
    };
  }
  if (
    !source ||
    (!opts?.sourceAccessGranted && source.ownerEmail !== ownerEmail)
  ) {
    return null;
  }
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = source.title ? `${source.title} (fork)` : "";
  const client = getDbExec();
  const orgId = getRequestOrgId() ?? null;
  await client.execute({
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, source_platform, source_app_id, source_url, org_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
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
      null,
      null,
      null,
      orgId,
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
    source: null,
    orgId,
    visibility: "private",
  };
}

export interface ListThreadsOptions {
  limit?: number;
  offset?: number;
  scope?: { type: string; id: string };
  unscopedOnly?: boolean;
  orgId?: string | null;
  includeArchived?: boolean;
  includeExternal?: boolean;
  sourceAppId?: string | null;
}

function chatThreadAccessSql(
  userEmail: string,
  orgId: string | null | undefined,
): { sql: string; args: (string | number)[] } {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const clauses = [
    `LOWER(owner_email) = ?`,
    `EXISTS (SELECT 1 FROM chat_thread_shares WHERE chat_thread_shares.resource_id = chat_threads.id AND chat_thread_shares.principal_type = 'user' AND LOWER(chat_thread_shares.principal_id) = ?)`,
  ];
  const args: (string | number)[] = [normalizedEmail, normalizedEmail];
  if (orgId) {
    clauses.push(`(visibility = 'org' AND org_id = ?)`);
    args.push(orgId);
    clauses.push(
      `EXISTS (SELECT 1 FROM chat_thread_shares WHERE chat_thread_shares.resource_id = chat_threads.id AND chat_thread_shares.principal_type = 'org' AND chat_thread_shares.principal_id = ?)`,
    );
    args.push(orgId);
  }
  return { sql: `(${clauses.join(" OR ")})`, args };
}

export async function listThreads(
  ownerEmail: string,
  options: ListThreadsOptions | number = {},
  legacyOffset?: number,
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const opts: ListThreadsOptions =
    typeof options === "number"
      ? { limit: options, offset: legacyOffset ?? 0 }
      : options;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const client = getDbExec();
  const access = chatThreadAccessSql(
    ownerEmail,
    opts.orgId ?? getRequestOrgId(),
  );
  const filters: string[] = [access.sql, `message_count > 0`];
  const args: (string | number)[] = [...access.args];
  if (!opts.includeArchived) {
    filters.push(`archived_at IS NULL`);
  }
  if (opts.includeExternal === false) {
    filters.push(`source_platform IS NULL`);
    if (opts.sourceAppId) {
      filters.push(`(source_app_id IS NULL OR source_app_id = ?)`);
      args.push(opts.sourceAppId);
    }
  }
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
  options: {
    scope?: { type: string; id: string };
    orgId?: string | null;
    includeArchived?: boolean;
    includeExternal?: boolean;
    sourceAppId?: string | null;
  } = {},
): Promise<ChatThreadSummary[]> {
  await ensureTable();
  const client = getDbExec();
  const pattern = `%${escapeLike(query)}%`;
  const access = chatThreadAccessSql(
    ownerEmail,
    options.orgId ?? getRequestOrgId(),
  );
  const filters: string[] = [
    access.sql,
    `message_count > 0`,
    `(title LIKE ? ESCAPE '!' OR preview LIKE ? ESCAPE '!' OR thread_data LIKE ? ESCAPE '!')`,
  ];
  const args: (string | number)[] = [...access.args, pattern, pattern, pattern];
  if (!options.includeArchived) {
    filters.push(`archived_at IS NULL`);
  }
  if (options.includeExternal === false) {
    filters.push(`source_platform IS NULL`);
    if (options.sourceAppId) {
      filters.push(`(source_app_id IS NULL OR source_app_id = ?)`);
      args.push(options.sourceAppId);
    }
  }
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
 * Scope a thread should carry after a run inside a resource: adopt when it has
 * none, otherwise keep what it has. An unscoped thread reads as general, and a
 * general chat renders inside every resource — so never retag, never clear.
 */
export function resolveRunThreadScope(
  existing: ChatThreadScope | null,
  incoming: ChatThreadScope | null | undefined,
): ChatThreadScope | null {
  if (existing) return existing;
  return incoming ?? null;
}

export async function adoptThreadScopeIfUnscoped(
  id: string,
  scope: ChatThreadScope,
): Promise<ChatThreadScope | null> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE chat_threads SET scope_type = ?, scope_id = ?, scope_label = ?, updated_at = ? WHERE id = ? AND scope_type IS NULL`,
    args: [
      scope.type,
      scope.id,
      scope.label ?? null,
      Math.max(Date.now(), 1),
      id,
    ],
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return scope;
  }
  return (await getThread(id))?.scope ?? null;
}

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
  const client = getDbExec();
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_THREAD_DATA_UPDATE_ATTEMPTS,
  );
  let lastConflict = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
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
      const nextTitle = title || current.title;
      const result = await client.execute({
        sql: `UPDATE chat_threads SET thread_data = ?, title = ?, preview = ?, message_count = ?, updated_at = ? WHERE id = ? AND updated_at = ?`,
        args: [
          nextThreadData,
          nextTitle,
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
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(250, THREAD_DATA_CONFLICT_BACKOFF_MS * (attempt + 1)),
        ),
      );
    }
  }

  if (lastError) throw lastError;

  if (lastConflict) {
    if (options.ignoreConflicts) return;
    const error = new Error(
      `Failed to update chat thread ${id} after concurrent write conflicts.`,
    ) as Error & { statusCode?: number; statusMessage?: string };
    error.statusCode = 409;
    error.statusMessage = error.message;
    throw error;
  }
}

export interface ThreadEngineMeta {
  engineName: string;
  model: string;
}

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

export async function setThreadQueuedMessages(
  threadId: string,
  queuedMessages: QueuedMessage[],
  options: { ownerEmail?: string } = {},
): Promise<boolean> {
  return withThreadDataLock(threadId, async () => {
    const thread = await getThread(threadId);
    if (!thread) return false;
    if (options.ownerEmail && thread.ownerEmail !== options.ownerEmail) {
      return false;
    }
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(thread.threadData);
    } catch {}
    data.queuedMessages = queuedMessages;
    await updateThreadData(
      threadId,
      JSON.stringify(data),
      thread.title,
      thread.preview,
      thread.messageCount,
      { preserveExistingQueuedMessages: false },
    );
    return true;
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
    const tokenHash = hashThreadShareToken(token);
    const data = parseThreadData(thread.threadData);
    const existing = normalizeThreadShare(data[THREAD_SHARE_DATA_KEY]);
    data[THREAD_SHARE_DATA_KEY] = {
      tokenHash,
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
    await setThreadShareTokenHashColumn(threadId, tokenHash);

    return {
      enabled: true,
      token,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
    };
  });
}

async function setThreadShareTokenHashColumn(
  threadId: string,
  tokenHash: string | null,
): Promise<void> {
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE chat_threads SET share_token_hash = ? WHERE id = ?`,
    args: [tokenHash, threadId],
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
    await setThreadShareTokenHashColumn(threadId, null);

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

  const validate = (row: Record<string, unknown>): ChatThread | null => {
    const thread = rowToThread(row);
    const stored = readStoredThreadShare(thread.threadData);
    if (!stored?.tokenHash || stored.revokedAt) return null;
    if (stored.tokenHash !== tokenHash) return null;
    return thread;
  };

  const indexed = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE share_token_hash = ? LIMIT 10`,
    args: [tokenHash],
  });
  for (const row of indexed.rows) {
    const thread = validate(row);
    if (thread) return thread;
  }

  const legacy = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE share_token_hash IS NULL AND thread_data LIKE ? LIMIT 10`,
    args: [`%${tokenHash}%`],
  });
  for (const row of legacy.rows) {
    const thread = validate(row);
    if (thread) {
      await setThreadShareTokenHashColumn(thread.id, tokenHash).catch(() => {});
      return thread;
    }
  }
  return null;
}

export async function grantThreadUserShare(
  threadId: string,
  userEmail: string,
  role: ShareRole,
  grantedBy: string,
): Promise<void> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  if (!threadId || !normalizedEmail.includes("@")) return;
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, role FROM chat_thread_shares WHERE resource_id = ? AND principal_type = 'user' AND LOWER(principal_id) = ?`,
    args: [threadId, normalizedEmail],
  });
  const existing = rows[0];
  if (existing) {
    if (roleSatisfies(existing.role as ShareRole, role)) return;
    await client.execute({
      sql: `UPDATE chat_thread_shares SET role = ? WHERE id = ?`,
      args: [role, existing.id as string],
    });
    return;
  }
  await client.execute({
    sql: `INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at) VALUES (?, ?, 'user', ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      threadId,
      normalizedEmail,
      role,
      grantedBy,
      new Date().toISOString(),
    ],
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
    await client
      .execute({
        sql: `DELETE FROM chat_thread_shares WHERE resource_id = ?`,
        args: [id],
      })
      .catch(() => {});
    emitChatThreadChange(id);
    return true;
  }
  return false;
}
