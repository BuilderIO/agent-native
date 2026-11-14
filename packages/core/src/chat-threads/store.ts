import crypto from "node:crypto";

import {
  createAgentThreadState,
  reduceAgentEvent,
} from "@agent-native/agentkit/client";
import {
  AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY,
  AGENT_NATIVE_SUBMISSION_TTL_MS_METADATA_KEY,
  AgentProtocolValidationError,
  agentEventSequenceEnd,
  type AgentEvent,
  parseQueueMessageInput,
  parseAgentEvent,
  parseForkThreadInput,
  type AgentSubmissionReference,
  type AgentSubmissionPayload,
  type AgentRunOptions,
} from "@agent-native/agentkit/protocol";

import {
  currentExecutionFence,
  withFencedExecutionWrite,
} from "../agent/execution-fence.js";
import { lockThreadRunSlot } from "../agent/run-slot-lock.js";
import { normalizeSubmissionDeadlineMetadata } from "../agent/submission-deadline.js";
import {
  extractThreadMeta,
  mergeThreadDataForClientSave,
  normalizeThreadRepository,
  normalizeThreadTitle,
  recordSteeredQueuedMessages,
  steeredQueuedMessageRecords,
  type SteeredQueuedMessageRecord,
  type ThreadAnnotationSnapshotConflict,
} from "../agent/thread-data-builder.js";
import {
  failedRunIdsWithError,
  isRenderedRunNotStartedNotice,
  projectRootAssistantMessages,
  threadMessageRecord,
} from "../agent/thread-message-projection.js";
import { getDbExec, type DbExec } from "../db/client.js";
import { createGetDb } from "../db/create-get-db.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import { fromMigrationEntries } from "../db/versioned-store-migrations.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { getRequestOrgId } from "../server/request-context.js";
import {
  assertNoInlineImageBytes,
  stripInlineBytes,
} from "../shared/inline-bytes.js";
import {
  ForbiddenError,
  hasCurrentOrgMembership,
  resolveAccess,
  type AccessContext,
} from "../sharing/access.js";
import { registerShareableResource } from "../sharing/registry.js";
import { roleSatisfies, type ShareRole } from "../sharing/schema.js";
import { emitChatThreadChange } from "./emitter.js";
import {
  CHAT_THREAD_SCHEMA_MIGRATIONS,
  CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE,
} from "./schema-migrations.js";
import {
  chatThreads,
  chatThreadShares,
  CHAT_THREAD_SHARES_CREATE_SQL,
  CHAT_THREAD_SHARES_RESOURCE_INDEX_SQL,
} from "./schema.js";

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
const MAX_QUEUED_RECEIPTS_TO_CHECK_FOR_RUN_BARRIER = 100;
const getChatThreadsDb = createGetDb({ chatThreads, chatThreadShares });

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

export const chatThreadsStore = defineStore({
  id: "chat_threads",
  migrations: [
    {
      name: "baseline",
      run: async () => {
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
      },
    },
    {
      name: "widen-bigint",
      run: async () => {
        // Widen millisecond-timestamp columns that older deployments created as
        // 32-bit `INTEGER`; on Postgres the `Date.now()` written on every turn
        // overflows int4. No-op once widened / on fresh BIGINT databases.
        await widenIntColumnsToBigInt("chat_threads", [
          "created_at",
          "updated_at",
          "pinned_at",
          "archived_at",
        ]);
      },
    },
    {
      name: "indexes",
      run: async () => {
        // Indexes for the hot read paths. Both the sidebar list and the
        // scoped/per-resource list filter on owner_email (and optionally
        // scope) and sort by updated_at. Probe pg_indexes first (no lock)
        // and skip the SHARE-locking CREATE INDEX when already present.
        await ensureIndexExists(
          "chat_threads_owner_updated_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_owner_updated_idx ON chat_threads (owner_email, updated_at)`,
        );
        // `owner_email` is stored as the user typed it, so access scoping
        // compares `LOWER(owner_email)`. A plain btree on the raw column cannot
        // serve that predicate — without the expression index the list falls
        // back to scanning every row in the (shared, multi-tenant) table.
        //
        // NOT built CONCURRENTLY, despite the SHARE lock. This ensure path runs
        // at release over the pooled Neon endpoint, and a transaction-pooled
        // connection cannot carry `CREATE INDEX CONCURRENTLY` to completion:
        // the statement returned without creating anything and the verifying
        // probe failed the whole release, so no docs production deploy could
        // publish. Release already runs locking DDL; a plain build here is the
        // form that actually lands.
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
        // Public share-link resolution looks threads up by token hash;
        // without this index it degrades to a LIKE scan over every blob.
        await ensureIndexExists(
          "chat_threads_share_token_idx",
          `CREATE INDEX IF NOT EXISTS chat_threads_share_token_idx ON chat_threads (share_token_hash)`,
        );
        await ensureIndexExists(
          "chat_thread_shares_resource_idx",
          CHAT_THREAD_SHARES_RESOURCE_INDEX_SQL,
        );
      },
    },
    ...fromMigrationEntries(
      CHAT_THREAD_SCHEMA_MIGRATIONS_TABLE,
      CHAT_THREAD_SCHEMA_MIGRATIONS,
      { data: [3] },
    ),
    {
      name: "viewer-state",
      sql: `CREATE TABLE IF NOT EXISTS chat_thread_viewer_state (
        thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        pinned_at BIGINT,
        hidden_at BIGINT,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (thread_id, user_email)
      )`,
    },
    {
      // Stands in for the inbox entries of the folded schema list (v5–v8),
      // which a local boot skips: a database whose snapshot or baseline was
      // already recorded otherwise keeps the v5 inbox shape while the
      // queued-submission queries select the v6/v8 columns. The ensure*
      // wrappers probe the catalog first, so a hosted replay of this entry
      // skips the lock-taking DDL once the shape exists.
      name: "chat-thread-inbox-runtime-schema",
      run: async () => {
        await ensureTableExists(
          "agent_chat_submission_inbox",
          `CREATE TABLE IF NOT EXISTS agent_chat_submission_inbox (
          thread_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          state TEXT NOT NULL,
          actor_email TEXT NOT NULL,
          actor_auth_user_id TEXT,
          actor_identity_authenticated_at_ms BIGINT,
          actor_name TEXT,
          actor_org_id TEXT,
          actor_org_scope TEXT,
          actor_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
          payload_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          interrupt_active_run BOOLEAN NOT NULL DEFAULT FALSE,
          submitted_run_id TEXT,
          queue_order BIGSERIAL NOT NULL,
          move_to_top_at BIGINT,
          retry_after BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (thread_id, message_id)
        )`,
        );
        await ensureIndexExists(
          "agent_chat_submission_inbox_pending_idx",
          `CREATE INDEX IF NOT EXISTS agent_chat_submission_inbox_pending_idx
          ON agent_chat_submission_inbox (state, retry_after, interrupt_active_run DESC, move_to_top_at DESC, queue_order ASC)`,
        );
        await ensureColumnExists(
          "agent_chat_submission_inbox",
          "interrupt_run_id",
          "ALTER TABLE agent_chat_submission_inbox ADD COLUMN IF NOT EXISTS interrupt_run_id TEXT",
        );
        await ensureColumnExists(
          "agent_chat_submission_inbox",
          "retry_count",
          "ALTER TABLE agent_chat_submission_inbox ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0",
        );
        await ensureIndexExists(
          "agent_chat_submission_inbox_thread_pending_idx",
          `CREATE INDEX IF NOT EXISTS agent_chat_submission_inbox_thread_pending_idx
          ON agent_chat_submission_inbox (thread_id, interrupt_active_run DESC, move_to_top_at DESC, queue_order ASC)
          WHERE state = 'queued'`,
        );
      },
    },
    {
      name: "edit-lineage",
      sql: [
        `ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS edit_root_id TEXT`,
        `ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS edit_prefix_count BIGINT`,
      ],
    },
  ],
});

function ensureTable(): Promise<void> {
  return chatThreadsStore.ready();
}

/**
 * Explicitly repair `message_count` for legacy rows written before the count
 * was maintained. This must never run from table/bootstrap initialization:
 * serverless isolates would each scan the full `thread_data` blob column on
 * cold start. Operators may invoke it once when upgrading an old database.
 */
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
    // guard:allow-unscoped — operator-invoked legacy repair scans all threads by explicit maintenance contract
    const { rows } = await client.execute({
      sql: `SELECT id, owner_email, thread_data, message_count FROM chat_threads
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
        sql: `UPDATE chat_threads SET message_count = ? WHERE id = ? AND message_count = 0 AND LOWER(owner_email) = LOWER(?)`,
        args: [count, afterId, row.owner_email],
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
  editRootId?: string;
  title: string;
  preview: string;
  threadData: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: ChatThreadScope | null;
  pinnedAt: number | null;
  hiddenAt?: number | null;
  archivedAt: number | null;
  source: ChatThreadSource | null;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

/**
 * Which of the caller's lists a thread belongs to. `mine` is ownership alone,
 * so a chat the caller owns stays in it however widely it is shared; `shared`
 * is accessible-but-owned-by-someone-else.
 */
export type ChatThreadOwnership = "all" | "mine" | "shared";

export const CHAT_THREAD_OWNERSHIPS: readonly ChatThreadOwnership[] = [
  "all",
  "mine",
  "shared",
];

export function isChatThreadOwnership(
  value: unknown,
): value is ChatThreadOwnership {
  return CHAT_THREAD_OWNERSHIPS.includes(value as ChatThreadOwnership);
}

/**
 * Why the caller can see a thread. A direct per-user grant outranks
 * organization access when both apply, so revoking the organization grant never
 * looks like it removed access the person was given by name.
 */
export type ChatThreadAccessBasis = "owner" | "direct" | "organization";

export interface ChatThreadSummary {
  id: string;
  editRootId?: string;
  ownerEmail?: string;
  accessBasis?: ChatThreadAccessBasis;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: ChatThreadScope | null;
  pinnedAt: number | null;
  hiddenAt?: number | null;
  archivedAt: number | null;
  source: ChatThreadSource | null;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

/** List and search rows always include the caller's ownership and access basis. */
export interface ChatThreadListRow extends ChatThreadSummary {
  ownerEmail: string;
  accessBasis: ChatThreadAccessBasis;
}

export class ForkThreadBoundaryError extends Error {
  constructor() {
    super("Invalid fork message boundary");
    this.name = "ForkThreadBoundaryError";
  }
}

export interface ForkThreadSourceSnapshot {
  threadData: string;
  title?: string;
  preview?: string;
  messageCount?: number;
  fromMessageId?: string;
  beforeMessageId?: string;
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
  fromMessageId?: string;
  beforeMessageId?: string;
  scope?: ChatThreadScope | null;
} | null {
  if (source?.beforeMessageId !== undefined) {
    try {
      parseForkThreadInput({
        threadId: "source",
        fromMessageId: source.fromMessageId,
        beforeMessageId: source.beforeMessageId,
      });
    } catch {
      throw new ForkThreadBoundaryError();
    }
  }
  if (!source || typeof source.threadData !== "string") {
    if (source?.beforeMessageId !== undefined)
      throw new ForkThreadBoundaryError();
    return null;
  }
  const threadData = source.threadData.trim();
  if (!threadData) {
    if (source.beforeMessageId !== undefined)
      throw new ForkThreadBoundaryError();
    return null;
  }

  let parsed: any;
  try {
    parsed = normalizeThreadRepository(JSON.parse(threadData));
  } catch {
    if (source.beforeMessageId !== undefined)
      throw new ForkThreadBoundaryError();
    return null;
  }
  parsed = stripInlineBytes(parsed, "placeholder");
  assertPersistableThreadData(
    JSON.stringify(parsed),
    "fork source thread_data",
  );

  const messageCount = countThreadMessages(parsed, 0);
  if (messageCount <= 0) {
    if (source.beforeMessageId !== undefined)
      throw new ForkThreadBoundaryError();
    return null;
  }

  return {
    threadData: JSON.stringify(parsed),
    title: typeof source.title === "string" ? source.title : "",
    preview: typeof source.preview === "string" ? source.preview : "",
    messageCount,
    ...(typeof source.fromMessageId === "string"
      ? { fromMessageId: source.fromMessageId }
      : {}),
    ...(typeof source.beforeMessageId === "string"
      ? { beforeMessageId: source.beforeMessageId }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(source, "scope")
      ? { scope: source.scope ?? null }
      : {}),
  };
}

function countThreadMessages(value: unknown, fallback: number): number {
  const repo = normalizeThreadRepository(value);
  if (!repo || typeof repo !== "object") return fallback;
  const repoMessageCount = Array.isArray(repo.messages)
    ? repo.messages.length
    : undefined;
  const agentKitMessageCount = Array.isArray(repo.agentKit?.messages)
    ? repo.agentKit.messages.length
    : undefined;
  if (repoMessageCount === undefined && agentKitMessageCount === undefined) {
    return fallback;
  }

  const failedRunIds = failedRunIdsWithError(repo.agentKit?.runs);
  const rootMessages = (
    Array.isArray(repo.messages) ? repo.messages : []
  ).filter(
    (entry: unknown) => !isRenderedRunNotStartedNotice(entry, failedRunIds),
  );
  const agentKitMessages = Array.isArray(repo.agentKit?.messages)
    ? repo.agentKit.messages
    : [];
  const assistantProjection = projectRootAssistantMessages({
    rootMessages,
    snapshotMessages: agentKitMessages,
    events: repo.agentKit?.events,
    runs: repo.agentKit?.runs,
    toolCalls: repo.agentKit?.toolCalls,
  });
  const mirroredRootIds = assistantProjection.representedRootMessageIds;
  const supersededSnapshotMessageIds =
    assistantProjection.supersededSnapshotMessageIds;
  const agentKitUserMessageId = (entry: unknown): string | undefined => {
    const message = threadMessageRecord(entry);
    if (message?.role !== "user") return undefined;
    const metadata = message.metadata;
    const custom =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).custom
        : undefined;
    const agentKitMessageId =
      custom && typeof custom === "object" && !Array.isArray(custom)
        ? (custom as Record<string, unknown>).agentKitMessageId
        : undefined;
    return typeof agentKitMessageId === "string"
      ? agentKitMessageId
      : undefined;
  };
  const snapshotUserMessageCounts = new Map<string, number>();
  for (const entry of agentKitMessages) {
    const message = threadMessageRecord(entry);
    if (message?.role !== "user" || typeof message.id !== "string") continue;
    snapshotUserMessageCounts.set(
      message.id,
      (snapshotUserMessageCounts.get(message.id) ?? 0) + 1,
    );
  }
  const rootUserMirrorIdsByAgentKitId = new Map<string, string[]>();
  for (const entry of rootMessages) {
    const message = threadMessageRecord(entry);
    const agentKitId = agentKitUserMessageId(entry);
    if (typeof message?.id !== "string" || !agentKitId) continue;
    const rootIds = rootUserMirrorIdsByAgentKitId.get(agentKitId);
    if (rootIds) rootIds.push(message.id);
    else rootUserMirrorIdsByAgentKitId.set(agentKitId, [message.id]);
  }
  const mirroredRootUserIds = new Set<string>();
  for (const [agentKitId, rootIds] of rootUserMirrorIdsByAgentKitId) {
    if (
      rootIds.length === 1 &&
      snapshotUserMessageCounts.get(agentKitId) === 1
    ) {
      mirroredRootUserIds.add(rootIds[0]!);
    }
  }
  const messageIds = new Set<string>();
  let unkeyedMessages = 0;
  const countMessage = (entry: unknown) => {
    const message = threadMessageRecord(entry);
    if (typeof message?.id === "string") messageIds.add(message.id);
    else unkeyedMessages += 1;
  };
  for (const entry of rootMessages) {
    const message = threadMessageRecord(entry);
    if (
      typeof message?.id === "string" &&
      (mirroredRootIds.has(message.id) || mirroredRootUserIds.has(message.id))
    ) {
      continue;
    }
    countMessage(entry);
  }
  for (const entry of agentKitMessages) {
    const message = threadMessageRecord(entry);
    if (
      typeof message?.id === "string" &&
      supersededSnapshotMessageIds.has(message.id)
    ) {
      continue;
    }
    countMessage(entry);
  }
  return messageIds.size + unkeyedMessages;
}

function forkThreadData(
  threadData: string,
  forkId: string,
  fromMessageId?: string,
  beforeMessageId?: string,
): string {
  const rawRepository = JSON.parse(threadData);
  const parsed = normalizeThreadRepository(rawRepository);
  const repository =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const messageId = (value: unknown) => {
    const message = threadMessageRecord(value);
    return typeof message?.id === "string" ? message.id : undefined;
  };
  const canonicalMessageId = (value: unknown) => {
    const message = threadMessageRecord(value);
    const custom = asRecord(asRecord(message?.metadata)?.custom);
    return typeof custom?.agentKitMessageId === "string"
      ? custom.agentKitMessageId
      : messageId(value);
  };
  if (beforeMessageId) {
    const raw = asRecord(rawRepository);
    const rawAgentKit = asRecord(raw?.agentKit);
    const aliasIds = new Set<string>();
    for (const list of [raw?.messages, rawAgentKit?.messages]) {
      if (!Array.isArray(list)) continue;
      const matches = list.filter(
        (message) =>
          messageId(message) === beforeMessageId ||
          canonicalMessageId(message) === beforeMessageId,
      );
      if (matches.length > 1) throw new ForkThreadBoundaryError();
      for (const match of matches) {
        const canonical = canonicalMessageId(match);
        if (canonical) aliasIds.add(canonical);
      }
    }
    if (aliasIds.size > 1) throw new ForkThreadBoundaryError();
  }
  const agentKit = repository?.agentKit;
  if (!agentKit || typeof agentKit !== "object" || Array.isArray(agentKit)) {
    if (!beforeMessageId) return threadData;
    const messages = Array.isArray(repository?.messages)
      ? repository.messages
      : [];
    const boundaryMatches = messages.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const message =
        record.message && typeof record.message === "object"
          ? (record.message as Record<string, unknown>)
          : record;
      return canonicalMessageId(message) === beforeMessageId ||
        messageId(message) === beforeMessageId
        ? [index]
        : [];
    });
    const boundary = boundaryMatches.at(0);
    if (boundaryMatches.length !== 1 || boundary === undefined)
      throw new ForkThreadBoundaryError();
    const retained = { ...repository };
    delete retained.resumeState;
    delete retained._steeredQueuedMessages;
    const prefix = messages.slice(0, boundary);
    const last = prefix.at(-1) as Record<string, unknown> | undefined;
    const lastMessage =
      last?.message && typeof last.message === "object"
        ? (last.message as Record<string, unknown>)
        : last;
    return JSON.stringify({
      ...retained,
      messages: prefix,
      headId: lastMessage?.id ?? null,
      queuedMessages: [],
    });
  }
  const agentKitRecord = agentKit as Record<string, unknown>;
  const repositoryMessages = Array.isArray(repository.messages)
    ? repository.messages
    : [];
  const protocolMessages = Array.isArray(agentKitRecord.messages)
    ? agentKitRecord.messages
    : [];
  const messageIds = new Set<string>();
  let boundaryId = beforeMessageId ?? fromMessageId;
  if (beforeMessageId) {
    const aliases = new Set<string>();
    for (const list of [repositoryMessages, protocolMessages]) {
      const matches = list.filter(
        (message) =>
          messageId(message) === beforeMessageId ||
          canonicalMessageId(message) === beforeMessageId,
      );
      if (matches.length > 1) throw new ForkThreadBoundaryError();
      for (const match of matches) {
        const canonical = canonicalMessageId(match);
        if (canonical) aliases.add(canonical);
      }
    }
    if (aliases.size !== 1) throw new ForkThreadBoundaryError();
    boundaryId = [...aliases][0];
  }
  const boundaryIdentity = beforeMessageId ? canonicalMessageId : messageId;
  if (boundaryId) {
    let found = false;
    const exclusiveMessages = protocolMessages.some(
      (message) => boundaryIdentity(message) === boundaryId,
    )
      ? protocolMessages
      : repositoryMessages;
    const messageLists = beforeMessageId
      ? [exclusiveMessages]
      : [repositoryMessages, protocolMessages];
    for (const messages of messageLists) {
      const throughIndex = messages.findIndex(
        (message) => boundaryIdentity(message) === boundaryId,
      );
      if (throughIndex >= 0) {
        found = true;
        for (const message of messages.slice(
          0,
          throughIndex + (beforeMessageId ? 0 : 1),
        )) {
          const id = boundaryIdentity(message);
          if (id) messageIds.add(id);
        }
      }
    }
    if (!found) {
      if (beforeMessageId) throw new ForkThreadBoundaryError();
      throw new Error(`Unknown message for fork: ${fromMessageId}`);
    }
  } else {
    for (const message of [...repositoryMessages, ...protocolMessages]) {
      const id = messageId(message);
      if (id) messageIds.add(id);
    }
  }
  const events = Array.isArray(agentKitRecord.events)
    ? agentKitRecord.events
    : [];
  const runs = Array.isArray(agentKitRecord.runs) ? agentKitRecord.runs : [];
  const eventBoundaries = new Map<string, number>();
  for (const rawEvent of events) {
    const event = asRecord(rawEvent);
    const message = asRecord(event?.message);
    const messageId =
      typeof event?.messageId === "string"
        ? event.messageId
        : typeof message?.id === "string"
          ? message.id
          : undefined;
    if (
      event?.type === "message.completed" &&
      typeof event?.runId === "string" &&
      typeof event.sequence === "number" &&
      messageId &&
      messageIds.has(messageId)
    ) {
      eventBoundaries.set(
        event.runId,
        Math.max(eventBoundaries.get(event.runId) ?? 0, event.sequence),
      );
    }
  }
  for (const rawRun of runs) {
    const run = asRecord(rawRun);
    if (
      typeof run?.id === "string" &&
      typeof run.activeMessageId === "string" &&
      messageIds.has(run.activeMessageId) &&
      typeof run.lastSequence === "number"
    ) {
      eventBoundaries.set(
        run.id,
        Math.max(eventBoundaries.get(run.id) ?? 0, run.lastSequence),
      );
    }
  }
  const retainedRunIds = new Set(eventBoundaries.keys());
  const nonterminalRunIds = new Set(
    runs.flatMap((rawRun) => {
      const run = asRecord(rawRun);
      return typeof run?.id === "string" &&
        (run.status === "queued" ||
          run.status === "running" ||
          run.status === "awaiting_approval" ||
          run.status === "awaiting_input")
        ? [run.id]
        : [];
    }),
  );
  const activeMessageIds = new Set(
    runs.flatMap((rawRun) => {
      const run = asRecord(rawRun);
      return typeof run?.id === "string" && nonterminalRunIds.has(run.id)
        ? [run.activeMessageId, run.inheritedMessageId].filter(
            (id): id is string => typeof id === "string",
          )
        : [];
    }),
  );
  // A legacy log may be out of order or incomplete. Only complete, valid run
  // traces can be replayed or exposed to the strict snapshot loader.
  let exclusiveEvents: AgentEvent[] = [];
  if (beforeMessageId) {
    const byRun = new Map<string, AgentEvent[]>();
    const incompleteRuns = new Set<string>();
    const slots: string[] = [];
    for (const rawEvent of events) {
      const event = asRecord(rawEvent);
      const runId = event?.runId;
      const boundary =
        typeof runId === "string" ? eventBoundaries.get(runId) : undefined;
      if (typeof runId !== "string" || boundary === undefined) continue;
      if (typeof event?.sequence === "number" && event.sequence > boundary)
        continue;
      let parsedEvent: AgentEvent;
      try {
        parsedEvent = parseAgentEvent({ ...event, threadId: forkId });
        if (agentEventSequenceEnd(parsedEvent) > boundary) {
          incompleteRuns.add(runId);
          continue;
        }
      } catch (error) {
        if (!(error instanceof AgentProtocolValidationError)) throw error;
        incompleteRuns.add(runId);
        continue;
      }
      slots.push(runId);
      const group = byRun.get(runId) ?? [];
      group.push(parsedEvent);
      byRun.set(runId, group);
    }
    const eventOwners = new Map<string, string>();
    for (const [runId, group] of byRun) {
      group.sort((a, b) => a.sequence - b.sequence);
      let next = 1;
      for (const event of group) {
        if (event.sequence !== next) incompleteRuns.add(runId);
        next = agentEventSequenceEnd(event) + 1;
        const owner = eventOwners.get(event.id);
        if (owner) {
          incompleteRuns.add(owner);
          incompleteRuns.add(runId);
        } else eventOwners.set(event.id, runId);
      }
    }
    const positions = new Map<string, number>();
    exclusiveEvents = slots.flatMap((runId) => {
      if (incompleteRuns.has(runId)) return [];
      const index = positions.get(runId) ?? 0;
      positions.set(runId, index + 1);
      const event = byRun.get(runId)?.[index];
      if (!event) throw new Error(`Fork event slot missing for run ${runId}`);
      return [event];
    });
  }
  const retainedActivityEvents = new Map<string, unknown>();
  if (beforeMessageId) {
    for (const rawEvent of exclusiveEvents) {
      const event = asRecord(rawEvent);
      const activity = asRecord(event?.activity);
      const runId = event?.runId;
      const boundary =
        typeof runId === "string" ? eventBoundaries.get(runId) : undefined;
      if (
        typeof runId !== "string" ||
        typeof activity?.id !== "string" ||
        boundary === undefined ||
        typeof event?.sequence !== "number" ||
        event.sequence > boundary ||
        ![
          "activity.started",
          "activity.updated",
          "activity.completed",
        ].includes(String(event.type))
      )
        continue;
      const key = JSON.stringify([runId, activity.id]);
      const previous = asRecord(retainedActivityEvents.get(key));
      if (!previous || Number(previous.sequence) <= event.sequence)
        retainedActivityEvents.set(key, rawEvent);
    }
  }
  const danglingActivityIds = new Set(
    [...retainedActivityEvents.entries()].flatMap(([key, event]) =>
      asRecord(asRecord(event)?.activity)?.status === "running" ? [key] : [],
    ),
  );
  const retainedMessageId = (value: unknown) => {
    const id = beforeMessageId ? canonicalMessageId(value) : messageId(value);
    return Boolean(id && messageIds.has(id));
  };
  const remapThreadId = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...value, threadId: forkId }
      : value;
  const {
    resumeState: _rootResumeState,
    _steeredQueuedMessages: _steeredQueuedMessages,
    ...retainedRepository
  } = repository;
  const {
    resumeState: _resumeState,
    checkpoint: _checkpoint,
    ...exclusiveAgentKit
  } = agentKitRecord;
  const exclusiveProjections = Object.fromEntries(
    [
      "activities",
      "tasks",
      "taskGroups",
      "agents",
      "interactions",
      "artifacts",
    ].flatMap((key) => {
      const entries = agentKitRecord[key];
      if (!Array.isArray(entries)) return [];
      return [
        [
          key,
          entries
            .filter((entry) => {
              const record = asRecord(entry);
              if (typeof record?.messageId === "string")
                return messageIds.has(record.messageId);
              return (
                typeof record?.runId === "string" &&
                retainedRunIds.has(record.runId)
              );
            })
            .map((entry) => {
              const record = asRecord(entry);
              // An exclusive fork has no live producer for retained work,
              // including legacy snapshots whose event replay is unavailable.
              return key === "activities" &&
                (record?.status === "running" ||
                  (typeof record?.runId === "string" &&
                    typeof record.id === "string" &&
                    danglingActivityIds.has(
                      JSON.stringify([record.runId, record.id]),
                    )))
                ? { ...record, status: "cancelled" }
                : entry;
            }),
        ],
      ];
    }),
  );
  const retainedEventState = beforeMessageId
    ? exclusiveEvents.reduce(
        (state, event) => reduceAgentEvent(state, event),
        createAgentThreadState(forkId),
      )
    : undefined;
  const withEventProjection = (key: string, projected: readonly unknown[]) => {
    const projectedIds = new Set(
      projected.flatMap((entry) => {
        const id = asRecord(entry)?.id;
        return typeof id === "string" ? [id] : [];
      }),
    );
    const scoped = Array.isArray(exclusiveProjections[key])
      ? exclusiveProjections[key]
      : [];
    return [
      ...scoped.filter((entry) => {
        const id = asRecord(entry)?.id;
        return typeof id !== "string" || !projectedIds.has(id);
      }),
      ...projected,
    ];
  };
  return JSON.stringify({
    ...(beforeMessageId ? retainedRepository : repository),
    ...(beforeMessageId ? { queuedMessages: [] } : {}),
    ...(beforeMessageId
      ? {
          headId:
            messageId(repositoryMessages.filter(retainedMessageId).at(-1)) ??
            null,
        }
      : {}),
    ...(Array.isArray(repository.messages)
      ? { messages: repositoryMessages.filter(retainedMessageId) }
      : {}),
    agentKit: {
      ...(beforeMessageId ? exclusiveAgentKit : agentKitRecord),
      ...(beforeMessageId
        ? {
            ...exclusiveProjections,
            agents: withEventProjection(
              "agents",
              Object.values(retainedEventState?.agents ?? {}),
            ),
            interactions: withEventProjection(
              "interactions",
              retainedEventState?.agentInteractions ?? [],
            ),
            artifacts: withEventProjection(
              "artifacts",
              retainedEventState?.artifacts ?? [],
            ),
            approvals: [],
            connectionRequests: [],
          }
        : {}),
      ...(Array.isArray(agentKitRecord.messages)
        ? {
            messages: agentKitRecord.messages
              .filter(retainedMessageId)
              .map((message) => {
                const record = asRecord(message)!;
                return typeof record.id === "string" &&
                  activeMessageIds.has(record.id) &&
                  record.status === "streaming"
                  ? { ...record, status: "complete" }
                  : record;
              }),
          }
        : {}),
      ...(Array.isArray(agentKitRecord.events)
        ? {
            events: (beforeMessageId ? exclusiveEvents : events).flatMap(
              (rawEvent) => {
                const event = asRecord(rawEvent);
                const runId = event?.runId;
                const boundary =
                  typeof runId === "string"
                    ? eventBoundaries.get(runId)
                    : undefined;
                if (
                  typeof runId !== "string" ||
                  boundary === undefined ||
                  typeof event?.sequence !== "number" ||
                  event.sequence > boundary
                ) {
                  return [];
                }
                if (
                  (event.type === "activity.started" ||
                    event.type === "activity.updated") &&
                  (!beforeMessageId
                    ? nonterminalRunIds.has(runId)
                    : typeof asRecord(event.activity)?.id === "string" &&
                      retainedActivityEvents.get(
                        JSON.stringify([runId, asRecord(event.activity)?.id]),
                      ) === rawEvent &&
                      danglingActivityIds.has(
                        JSON.stringify([runId, asRecord(event.activity)?.id]),
                      ))
                ) {
                  const activity = asRecord(event.activity);
                  if (activity?.status === "running") {
                    return [
                      {
                        ...event,
                        type: "activity.completed",
                        activity: { ...activity, status: "cancelled" },
                        threadId: forkId,
                      },
                    ];
                  }
                }
                return [remapThreadId(rawEvent)];
              },
            ),
          }
        : {}),
      ...(Array.isArray(agentKitRecord.runs)
        ? {
            runs: runs.flatMap((rawRun) => {
              const run = asRecord(rawRun);
              if (typeof run?.id !== "string" || !retainedRunIds.has(run.id)) {
                return [];
              }
              const copied: Record<string, unknown> = {
                ...run,
                threadId: forkId,
              };
              if (nonterminalRunIds.has(run.id)) {
                copied.status = "cancelled";
                delete copied.activeMessageId;
                delete copied.inheritedMessageId;
              }
              return [copied];
            }),
          }
        : {}),
      ...(boundaryId && Array.isArray(agentKitRecord.toolCalls)
        ? {
            toolCalls: agentKitRecord.toolCalls.filter((rawToolCall) => {
              const toolCall = asRecord(rawToolCall);
              if (typeof toolCall?.messageId === "string") {
                return messageIds.has(toolCall.messageId);
              }
              return (
                typeof toolCall?.runId === "string" &&
                retainedRunIds.has(toolCall.runId)
              );
            }),
          }
        : {}),
      ...(Array.isArray(agentKitRecord.widgets)
        ? {
            widgets: agentKitRecord.widgets.filter((widget) => {
              const record = asRecord(widget);
              return (
                typeof record?.messageId === "string" &&
                messageIds.has(record.messageId)
              );
            }),
          }
        : {}),
      ...(Array.isArray(agentKitRecord.annotations)
        ? {
            annotations: agentKitRecord.annotations.filter((annotation) => {
              const record = asRecord(annotation);
              return (
                typeof record?.messageId === "string" &&
                messageIds.has(record.messageId)
              );
            }),
          }
        : {}),
      ...(boundaryId ? { suggestions: [] } : {}),
      activeRunIds: [],
    },
  });
}

function deriveMessageCount(threadData: unknown, fallback: number): number {
  if (typeof threadData !== "string" || !threadData.trim()) return fallback;
  try {
    return countThreadMessages(JSON.parse(threadData), fallback);
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
    ...(typeof r.edit_root_id === "string"
      ? { editRootId: r.edit_root_id }
      : {}),
    ownerEmail: r.owner_email as string,
    title: r.title as string,
    preview: r.preview as string,
    threadData,
    messageCount: deriveMessageCount(threadData, storedCount),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    scope: readScope(r),
    pinnedAt: readNullableNumber(r.pinned_at),
    hiddenAt: readNullableNumber(r.hidden_at),
    archivedAt: readNullableNumber(r.archived_at),
    source: readSource(r),
    orgId: (r.org_id as string | null | undefined) ?? null,
    visibility: readVisibility(r.visibility),
  };
}

function readAccessBasis(value: unknown): ChatThreadAccessBasis {
  if (value === "owner" || value === "direct" || value === "organization") {
    return value;
  }
  throw new Error(`Unexpected chat thread access basis: ${String(value)}`);
}

function rowToSummary(r: Record<string, unknown>): ChatThreadListRow | null {
  // The summary path never loads `thread_data`; the count comes from the
  // dedicated `message_count` column maintained on write. Empty threads are
  // filtered out of the list.
  const messageCount = Number(r.message_count);
  if (!Number.isFinite(messageCount) || messageCount <= 0) return null;
  return {
    id: r.id as string,
    ...(typeof r.edit_root_id === "string"
      ? { editRootId: r.edit_root_id }
      : {}),
    ownerEmail: r.owner_email as string,
    accessBasis: readAccessBasis(r.access_basis),
    title: r.title as string,
    preview: r.preview as string,
    messageCount,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    scope: readScope(r),
    pinnedAt: readNullableNumber(r.pinned_at),
    hiddenAt: readNullableNumber(r.hidden_at),
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
    /** Explicit owner organization for durable/background callers. */
    orgId?: string | null;
    initialData?: {
      threadData: string;
      preview: string;
      messageCount: number;
    };
  },
): Promise<ChatThread> {
  await ensureTable();
  const id = opts?.id ?? generateId();
  const now = Date.now();
  const title = opts?.title ?? "";
  const scope = opts?.scope ?? null;
  const source = opts?.source ?? null;
  const orgId = opts?.orgId ?? getRequestOrgId() ?? null;
  const initialData = opts?.initialData;
  const preview = initialData?.preview ?? "";
  const threadData = initialData?.threadData ?? "{}";
  const messageCount = initialData?.messageCount ?? 0;
  if (!Number.isInteger(messageCount) || messageCount < 0) {
    throw new TypeError("Initial chat thread message count is invalid.");
  }
  assertPersistableThreadData(threadData, "thread_data");

  await withFencedExecutionWrite((tx) =>
    tx.execute({
      // A parent run may atomically create a child thread before that child has a lease.
      sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, source_platform, source_app_id, source_url, org_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
      args: [
        id,
        ownerEmail,
        title,
        preview,
        threadData,
        messageCount,
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
    }),
  );

  return {
    id,
    ownerEmail,
    title,
    preview,
    threadData,
    messageCount,
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

const THREAD_COLUMNS = `id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at, source_platform, source_app_id, source_url, org_id, visibility, edit_root_id`;
// The list/summary path deliberately omits `thread_data`: it is the full
// message-history JSON blob and selecting it for every row turns "open the
// sidebar" into "download every conversation". The summary derives nothing
// from the blob anymore — preview and message_count are dedicated columns
// (message_count is maintained on write). The detail path (`THREAD_COLUMNS` /
// `getThread`) still returns the full blob.
const SUMMARY_COLUMNS = `id, owner_email, title, preview, message_count, created_at, updated_at, scope_type, scope_id, scope_label, pinned_at, archived_at, source_platform, source_app_id, source_url, org_id, visibility, edit_root_id`;

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
    confirmOrgVisibility: true,
    ownerAccessIgnoresOrg: true,
  });
}

export function ensureChatThreadTables(): Promise<void> {
  return chatThreadsStore.ready();
}

/**
 * Yes/no access check that never reads the conversation body. Callers that
 * only need the answer (run polling, run ownership) must use this, not
 * `resolveThreadAccess`: that one returns the whole thread, and `thread_data`
 * is the full message history, so a boolean check would pull megabytes per call.
 */
export async function hasThreadAccess(
  userEmail: string | null | undefined,
  threadId: string | null | undefined,
  minRole: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
): Promise<boolean> {
  if (!userEmail || !threadId) return false;
  // `skipResourceBody` keeps the access load a projected row. Without it the
  // load is an unprojected `select()` that pulls `thread_data`.
  const access = await resolveAccess(
    "chat_thread",
    threadId,
    { userEmail, orgId: ctx.orgId },
    { skipResourceBody: true },
  );
  return !!access && roleSatisfies(access.role, minRole);
}

export async function resolveThreadAccess(
  userEmail: string | null | undefined,
  threadId: string | null | undefined,
  minRole: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
): Promise<ChatThread | null> {
  if (!userEmail || !threadId) return null;
  if (!(await hasThreadAccess(userEmail, threadId, minRole, ctx))) return null;
  const thread = await getThread(threadId);
  if (!thread) return null;
  if (
    normalizeAccessEmail(thread.ownerEmail) === normalizeAccessEmail(userEmail)
  ) {
    return { ...thread, hiddenAt: null };
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT pinned_at, hidden_at FROM chat_thread_viewer_state WHERE thread_id = ? AND user_email = ?`,
    args: [threadId, normalizeAccessEmail(userEmail)],
  });
  return {
    ...thread,
    pinnedAt: readNullableNumber(rows[0]?.pinned_at),
    hiddenAt: readNullableNumber(rows[0]?.hidden_at),
  };
}

export async function resolveThreadAccessScope(
  userEmail: string | null | undefined,
  threadId: string | null | undefined,
  minRole: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
): Promise<{ scope: ChatThreadScope | null } | null> {
  if (!userEmail || !threadId) return null;
  const access = await resolveAccess(
    "chat_thread",
    threadId,
    { userEmail, orgId: ctx.orgId },
    { skipResourceBody: true },
  );
  if (!access || !roleSatisfies(access.role, minRole)) return null;

  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: "SELECT scope_type, scope_id, scope_label FROM chat_threads WHERE id = ?",
    args: [threadId],
  });
  const row = rows[0];
  if (!row) return null;
  return { scope: readScope(row as Record<string, unknown>) };
}

export async function resolveThreadAppAccessScope(
  userEmail: string | null | undefined,
  threadId: string | null | undefined,
  minRole: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
): Promise<{
  scope: ChatThreadScope | null;
  source: ChatThreadSource | null;
} | null> {
  const access = await resolveThreadAccessScope(
    userEmail,
    threadId,
    minRole,
    ctx,
  );
  if (!access) return null;
  // guard:allow-unscoped — reads provenance only after resolveThreadAccessScope granted access to this thread
  const { rows } = await getDbExec().execute({
    sql: "SELECT source_platform, source_app_id, source_url FROM chat_threads WHERE id = ?",
    args: [threadId],
  });
  if (!rows[0]) return null;
  return { ...access, source: readSource(rows[0] as Record<string, unknown>) };
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
  const access = await chatThreadAccessSql(userEmail, ctx.orgId);
  const client = getDbExec();
  const placeholders = ids.map(() => "?").join(", ");
  const projection = chatThreadViewerSelect(THREAD_COLUMNS, userEmail);
  const { rows } = await client.execute({
    sql: `SELECT ${projection.sql} FROM chat_threads WHERE id IN (${placeholders}) AND ${access.sql}`,
    args: [...projection.args, ...ids, ...access.args],
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
  // guard:allow-unscoped — internal lookup; request handlers validate owner/share access before returning or mutating data
  const { rows } = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToThread(rows[0]);
}

/**
 * Fill missing provenance on a thread without rewriting an established origin.
 * Integration retries and long-lived mapped conversations both pass through
 * this path, so the first source remains the source shown in chat history.
 */
export async function setThreadSourceIfMissing(
  id: string,
  ownerEmail: string,
  source: ChatThreadSource | null | undefined,
): Promise<boolean> {
  if (!source || (!source.platform && !source.appId && !source.url)) {
    return false;
  }
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE chat_threads SET source_platform = COALESCE(source_platform, ?), source_app_id = COALESCE(source_app_id, ?), source_url = COALESCE(source_url, ?) WHERE id = ? AND LOWER(owner_email) = LOWER(?)`,
    args: [
      source.platform ?? null,
      source.appId ?? null,
      source.url ?? null,
      id,
      ownerEmail,
    ],
  });
  return result.rowsAffected > 0;
}

async function lockEditRoot(
  tx: DbExec,
  source: ChatThread,
  ownerEmail: string,
): Promise<boolean> {
  const rootId = source.editRootId ?? source.id;
  const result = await tx.execute({
    sql: `SELECT id FROM chat_threads WHERE id = ? AND LOWER(owner_email) = LOWER(?) AND org_id IS NOT DISTINCT FROM ? AND source_app_id IS NOT DISTINCT FROM ? AND source_platform IS NOT DISTINCT FROM ? AND scope_type IS NOT DISTINCT FROM ? AND scope_id IS NOT DISTINCT FROM ? AND edit_root_id IS NULL FOR UPDATE`,
    args: [
      rootId,
      ownerEmail,
      source.orgId,
      source.source?.appId ?? null,
      source.source?.platform ?? null,
      source.scope?.type ?? null,
      source.scope?.id ?? null,
    ],
  });
  return result.rows.length === 1;
}

export async function forkThread(
  sourceId: string,
  ownerEmail: string,
  opts?: {
    id?: string;
    source?: ForkThreadSourceSnapshot | null;
    sourceAccessGranted?: boolean;
    forkPurpose?: "edit";
    trustedAppId?: string | null;
    targetSource?: ChatThreadSource | null;
  },
): Promise<ChatThread | null> {
  const snapshot = normalizeForkSourceSnapshot(opts?.source);
  const forkPurpose: unknown = opts?.forkPurpose;
  if (forkPurpose !== undefined && forkPurpose !== "edit")
    throw new TypeError("Invalid fork purpose");
  if (opts?.forkPurpose === "edit" && !snapshot?.beforeMessageId)
    throw new ForkThreadBoundaryError();
  let source = await getThread(sourceId);
  // Exclusive forks are cut from authorized durable history, never a replacement snapshot.
  if (snapshot?.beforeMessageId && !source) return null;
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
          if (snapshot.scope === undefined) {
            throw new Error("Normalized fork source scope must be explicit");
          }
          await setThreadScope(sourceId, ownerEmail, snapshot.scope);
        }
        source = await getThread(sourceId);
      }
    }
  } else if (
    snapshot &&
    !snapshot.beforeMessageId &&
    source.ownerEmail === ownerEmail &&
    (snapshot.fromMessageId || snapshot.messageCount > source.messageCount)
  ) {
    // Message-scoped forks intentionally carry a truncated snapshot even when
    // the persisted source has later messages; full forks only overlay fresher
    // client snapshots.
    source = {
      ...source,
      threadData: snapshot.threadData,
      title: snapshot.title || source.title,
      preview: snapshot.fromMessageId
        ? snapshot.preview
        : snapshot.preview || source.preview,
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
  const threadData = JSON.stringify(
    stripInlineBytes(
      JSON.parse(
        forkThreadData(
          source.threadData,
          id,
          snapshot?.fromMessageId,
          snapshot?.beforeMessageId,
        ),
      ),
      "placeholder",
    ),
  );
  assertPersistableThreadData(threadData, "forked thread_data");
  const bounded = Boolean(snapshot?.beforeMessageId);
  const messageCount = bounded
    ? countThreadMessages(JSON.parse(threadData), 0)
    : source.messageCount;
  const preview = bounded ? "" : source.preview;
  const now = Date.now();
  const edit = opts?.forkPurpose === "edit";
  const title = edit
    ? source.title
    : source.title
      ? `${source.title} (fork)`
      : "";
  const client = getDbExec();
  const orgId = getRequestOrgId() ?? null;
  const trustedSource =
    edit &&
    !!opts.trustedAppId &&
    !source.source?.platform &&
    source.source?.appId === opts.trustedAppId;
  const targetSource =
    opts?.targetSource ?? (trustedSource ? source.source : null);
  const targetMatchesEditSource =
    !targetSource?.platform && targetSource?.appId === opts?.trustedAppId;
  const editRootId =
    trustedSource &&
    targetMatchesEditSource &&
    source.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() &&
    source.orgId === orgId
      ? (source.editRootId ?? source.id)
      : null;
  const insert = {
    sql: `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, scope_type, scope_id, scope_label, source_platform, source_app_id, source_url, org_id, edit_root_id, edit_prefix_count, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
    args: [
      id,
      ownerEmail,
      title,
      preview,
      threadData,
      messageCount,
      now,
      now,
      source.scope?.type ?? null,
      source.scope?.id ?? null,
      source.scope?.label ?? null,
      targetSource?.platform ?? null,
      targetSource?.appId ?? null,
      targetSource?.url ?? null,
      orgId,
      editRootId,
      edit ? messageCount : null,
    ],
  };
  if (editRootId) {
    if (!client.transaction)
      throw new Error("Atomic chat edit requires transaction support");
    const inserted = await client.transaction(async (tx) => {
      if (!(await lockEditRoot(tx, source, ownerEmail))) return false;
      const current = await tx.execute({
        sql: `SELECT id FROM chat_threads WHERE id = ? AND LOWER(owner_email) = LOWER(?) AND org_id IS NOT DISTINCT FROM ? AND source_app_id IS NOT DISTINCT FROM ? AND source_platform IS NOT DISTINCT FROM ? AND scope_type IS NOT DISTINCT FROM ? AND scope_id IS NOT DISTINCT FROM ? AND thread_data = ? AND title = ? AND COALESCE(edit_root_id, id) = ? FOR UPDATE`,
        args: [
          source.id,
          ownerEmail,
          source.orgId,
          source.source?.appId ?? null,
          source.source?.platform ?? null,
          source.scope?.type ?? null,
          source.scope?.id ?? null,
          source.threadData,
          source.title,
          editRootId,
        ],
      });
      if (!current.rows.length) return false;
      await tx.execute(insert);
      return true;
    });
    if (!inserted) return null;
  } else {
    await client.execute(insert);
  }
  return {
    id,
    ownerEmail,
    ...(editRootId ? { editRootId } : {}),
    title,
    preview,
    threadData,
    messageCount,
    createdAt: now,
    updatedAt: now,
    scope: source.scope,
    pinnedAt: null,
    archivedAt: null,
    source: targetSource,
    orgId,
    visibility: "private",
  };
}

export interface ListThreadsOptions {
  collapseEdits?: boolean;
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
  orgId?: string | null;
  /**
   * Include archived threads in the results. Defaults to false: archived
   * threads (`archived_at` set via `setThreadArchived`) are hidden from the
   * ordinary chat list/search so archiving actually removes a thread from
   * view. Pass true for surfaces that explicitly need to see archived chats
   * (e.g. an "Archived" filter or restoring one via `setThreadArchived`).
   */
  includeArchived?: boolean;
  /** Include chats hidden by this caller. Defaults to false. */
  includeHidden?: boolean;
  /**
   * Include connected and other-app threads. The HTTP chat list defaults this
   * to false so each app shows its own local chats first; internal callers
   * keep the historical all-sources behavior unless they opt out explicitly.
   */
  includeExternal?: boolean;
  /** Current app id used by the local-only view. */
  sourceAppId?: string | null;
  /** Defaults to `all`. Narrowed in SQL, so LIMIT/OFFSET page within the list. */
  ownership?: ChatThreadOwnership;
}

async function chatThreadAccessSql(
  userEmail: string,
  orgId: string | null | undefined,
): Promise<{ sql: string; args: (string | number)[] }> {
  const normalizedEmail = normalizeAccessEmail(userEmail);
  const clauses = [
    `LOWER(owner_email) = ?`,
    `EXISTS (SELECT 1 FROM chat_thread_shares WHERE chat_thread_shares.resource_id = chat_threads.id AND chat_thread_shares.principal_type = 'user' AND LOWER(chat_thread_shares.principal_id) = ?)`,
  ];
  const args: (string | number)[] = [normalizedEmail, normalizedEmail];
  if (
    orgId &&
    (await hasCurrentOrgMembership(
      { getDb: getChatThreadsDb },
      orgId,
      normalizedEmail,
      { userEmail: normalizedEmail, orgId },
    ))
  ) {
    clauses.push(`(visibility = 'org' AND org_id = ?)`);
    args.push(orgId);
    clauses.push(
      `EXISTS (SELECT 1 FROM chat_thread_shares WHERE chat_thread_shares.resource_id = chat_threads.id AND chat_thread_shares.principal_type = 'org' AND chat_thread_shares.principal_id = ?)`,
    );
    args.push(orgId);
  }
  return { sql: `(${clauses.join(" OR ")})`, args };
}

function normalizeAccessEmail(userEmail: string): string {
  return userEmail.trim().toLowerCase();
}

function chatThreadViewerSelect(
  columns: string,
  userEmail: string,
): {
  sql: string;
  args: string[];
} {
  const email = normalizeAccessEmail(userEmail);
  const viewerValue = (column: string) =>
    `(SELECT ${column} FROM chat_thread_viewer_state WHERE thread_id = chat_threads.id AND user_email = ?)`;
  return {
    sql: `${columns.replace("pinned_at", `CASE WHEN LOWER(owner_email) = ? THEN pinned_at ELSE ${viewerValue("pinned_at")} END AS pinned_at`)}, CASE WHEN LOWER(owner_email) = ? THEN NULL ELSE ${viewerValue("hidden_at")} END AS hidden_at`,
    args: [email, email, email, email],
  };
}

/**
 * Summary projection plus the caller's access basis, derived from the same
 * owner and per-user-share comparisons the ACL uses. Anything that is neither
 * owned nor directly granted reached the caller through the organization.
 */
function chatThreadSummarySelect(userEmail: string): {
  sql: string;
  args: string[];
} {
  const normalizedEmail = normalizeAccessEmail(userEmail);
  const viewer = chatThreadViewerSelect(SUMMARY_COLUMNS, userEmail);
  return {
    sql: `${viewer.sql}, CASE WHEN LOWER(owner_email) = ? THEN 'owner' WHEN EXISTS (SELECT 1 FROM chat_thread_shares WHERE chat_thread_shares.resource_id = chat_threads.id AND chat_thread_shares.principal_type = 'user' AND LOWER(chat_thread_shares.principal_id) = ?) THEN 'direct' ELSE 'organization' END AS access_basis`,
    args: [...viewer.args, normalizedEmail, normalizedEmail],
  };
}

function chatThreadOwnershipSql(
  userEmail: string,
  ownership: ChatThreadOwnership | undefined,
): { sql: string; args: string[] } | null {
  if (ownership === undefined || ownership === "all") return null;
  const normalizedEmail = normalizeAccessEmail(userEmail);
  if (ownership === "mine") {
    return { sql: `LOWER(owner_email) = ?`, args: [normalizedEmail] };
  }
  if (ownership === "shared") {
    return { sql: `LOWER(owner_email) <> ?`, args: [normalizedEmail] };
  }
  throw new Error(`Unknown chat thread ownership: ${String(ownership)}`);
}

export async function listThreads(
  ownerEmail: string,
  options: ListThreadsOptions | number = {},
  legacyOffset?: number,
): Promise<ChatThreadListRow[]> {
  await ensureTable();
  // Back-compat shim: previous signature was (owner, limit, offset).
  const opts: ListThreadsOptions =
    typeof options === "number"
      ? { limit: options, offset: legacyOffset ?? 0 }
      : options;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const client = getDbExec();
  // `message_count > 0` is the authoritative "has messages" signal maintained
  // on every write. `source_platform` is the authoritative external-source
  // signal: schema migration 3 backfilled the integration rows that predate the
  // column, so nothing here may filter on `thread_data`. Matching that blob
  // detoasts the whole message history for every scanned row — before LIMIT
  // applies — which is what made this list cost seconds instead of milliseconds.
  const access = await chatThreadAccessSql(
    ownerEmail,
    opts.orgId === undefined ? getRequestOrgId() : opts.orgId,
  );
  const ownershipFilter = chatThreadOwnershipSql(ownerEmail, opts.ownership);
  const select = chatThreadSummarySelect(ownerEmail);
  const filters: string[] = [access.sql, `message_count > 0`];
  const args: (string | number)[] = [...select.args, ...access.args];
  if (ownershipFilter) {
    filters.push(ownershipFilter.sql);
    args.push(...ownershipFilter.args);
  }
  if (!opts.includeHidden) {
    filters.push(
      `(LOWER(owner_email) = ? OR NOT EXISTS (SELECT 1 FROM chat_thread_viewer_state WHERE thread_id = chat_threads.id AND user_email = ? AND hidden_at IS NOT NULL))`,
    );
    args.push(
      normalizeAccessEmail(ownerEmail),
      normalizeAccessEmail(ownerEmail),
    );
  }
  if (!opts.includeArchived) {
    filters.push(`archived_at IS NULL`);
  }
  if (opts.includeExternal === false) {
    filters.push(`source_platform IS NULL`);
    // A local app view needs proven attribution; unknown legacy rows remain
    // stored, but cannot be adopted into whichever app reads them first.
    const sourceAppId =
      typeof opts.sourceAppId === "string" ? opts.sourceAppId.trim() : "";
    if (!sourceAppId) return [];
    filters.push(`source_app_id = ?`);
    args.push(sourceAppId);
  }
  if (opts.scope) {
    filters.push(`scope_type = ? AND scope_id = ?`);
    args.push(opts.scope.type, opts.scope.id);
  } else if (opts.unscopedOnly) {
    filters.push(`scope_type IS NULL`);
  }
  if (opts.collapseEdits) {
    filters.push(
      `(edit_prefix_count IS NULL OR message_count > edit_prefix_count)`,
    );
  }
  args.push(limit, offset);
  const partition = `LOWER(owner_email), org_id, source_app_id, scope_type, scope_id, COALESCE(edit_root_id, id)`;
  // raw-sql-ok: interpolates fixed column lists and filter clauses built from constants; every value is bound
  const query = opts.collapseEdits
    ? // guard:allow-unbounded-read — ranks only the filtered CTE's rows; the outer select is LIMITed
      `WITH filtered AS (SELECT ${select.sql} FROM chat_threads WHERE ${filters.join(" AND ")}), ranked AS (SELECT filtered.*, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY created_at DESC, id DESC) AS edit_rank, MAX(pinned_at) OVER (PARTITION BY ${partition}) AS edit_pinned_at FROM filtered) SELECT ${SUMMARY_COLUMNS.replace("pinned_at", "edit_pinned_at AS pinned_at")}, hidden_at, access_basis FROM ranked WHERE edit_rank = 1 ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id ASC LIMIT ? OFFSET ?`
    : `SELECT ${select.sql} FROM chat_threads WHERE ${filters.join(" AND ")} ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id ASC LIMIT ? OFFSET ?`;
  const { rows } = await client.execute({ sql: query, args });
  return rows
    .map((r) => rowToSummary(r))
    .filter((r): r is ChatThreadListRow => r !== null);
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
    collapseEdits?: boolean;
    /** See `ListThreadsOptions.includeArchived` — defaults to false. */
    includeArchived?: boolean;
    /** Include chats hidden by this caller. Defaults to false. */
    includeHidden?: boolean;
    /** See `ListThreadsOptions.includeExternal`. */
    includeExternal?: boolean;
    /** Current app id used by the local-only view. */
    sourceAppId?: string | null;
    /** See `ListThreadsOptions.ownership`. */
    ownership?: ChatThreadOwnership;
    offset?: number;
  } = {},
): Promise<ChatThreadListRow[]> {
  await ensureTable();
  const client = getDbExec();
  const pattern = `%${escapeLike(query)}%`;
  // The count-guard uses the maintained `message_count` column (same as
  // listThreads). The content match still scans `thread_data` — search
  // legitimately needs to look inside message history.
  const access = await chatThreadAccessSql(
    ownerEmail,
    options.orgId === undefined ? getRequestOrgId() : options.orgId,
  );
  const ownershipFilter = chatThreadOwnershipSql(ownerEmail, options.ownership);
  const select = chatThreadSummarySelect(ownerEmail);
  const filters: string[] = [
    access.sql,
    `message_count > 0`,
    `(title LIKE ? ESCAPE '!' OR preview LIKE ? ESCAPE '!' OR thread_data LIKE ? ESCAPE '!')`,
  ];
  const args: (string | number)[] = [
    ...select.args,
    ...access.args,
    pattern,
    pattern,
    pattern,
  ];
  if (ownershipFilter) {
    filters.push(ownershipFilter.sql);
    args.push(...ownershipFilter.args);
  }
  if (!options.includeHidden) {
    filters.push(
      `(LOWER(owner_email) = ? OR NOT EXISTS (SELECT 1 FROM chat_thread_viewer_state WHERE thread_id = chat_threads.id AND user_email = ? AND hidden_at IS NOT NULL))`,
    );
    args.push(
      normalizeAccessEmail(ownerEmail),
      normalizeAccessEmail(ownerEmail),
    );
  }
  if (!options.includeArchived) {
    filters.push(`archived_at IS NULL`);
  }
  if (options.includeExternal === false) {
    filters.push(`source_platform IS NULL`);
    // A local app view needs proven attribution; unknown legacy rows remain
    // stored, but cannot be adopted into whichever app reads them first.
    const sourceAppId =
      typeof options.sourceAppId === "string" ? options.sourceAppId.trim() : "";
    if (!sourceAppId) return [];
    filters.push(`source_app_id = ?`);
    args.push(sourceAppId);
  }
  if (options.scope) {
    filters.push(`scope_type = ? AND scope_id = ?`);
    args.push(options.scope.type, options.scope.id);
  }
  if (options.collapseEdits) {
    filters.push(
      `(edit_prefix_count IS NULL OR message_count > edit_prefix_count)`,
    );
  }
  args.push(limit, options.offset ?? 0);
  const partition = `LOWER(owner_email), org_id, source_app_id, scope_type, scope_id, COALESCE(edit_root_id, id)`;
  // raw-sql-ok: interpolates fixed column lists and filter clauses built from constants; every value is bound
  const querySql = options.collapseEdits
    ? // guard:allow-unbounded-read — ranks only the filtered CTE's rows; the outer select is LIMITed
      `WITH filtered AS (SELECT ${select.sql} FROM chat_threads WHERE ${filters.join(" AND ")}), ranked AS (SELECT filtered.*, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY created_at DESC, id DESC) AS edit_rank, MAX(pinned_at) OVER (PARTITION BY ${partition}) AS edit_pinned_at FROM filtered) SELECT ${SUMMARY_COLUMNS.replace("pinned_at", "edit_pinned_at AS pinned_at")}, hidden_at, access_basis FROM ranked WHERE edit_rank = 1 ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id ASC LIMIT ? OFFSET ?`
    : `SELECT ${select.sql} FROM chat_threads WHERE ${filters.join(" AND ")} ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id ASC LIMIT ? OFFSET ?`;
  const { rows } = await client.execute({ sql: querySql, args });
  return rows
    .map((r) => rowToSummary(r))
    .filter((r): r is ChatThreadListRow => r !== null);
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

/**
 * Claim an unscoped thread for `scope`, returning the scope it actually ends up
 * with. `withThreadDataLock` only serializes one process, so two workers can
 * both read the same unscoped row; the `scope_type IS NULL` guard makes the
 * first writer win and the loser reports the winner instead of retagging.
 */
export async function adoptThreadScopeIfUnscoped(
  id: string,
  ownerEmail: string,
  scope: ChatThreadScope,
): Promise<ChatThreadScope | null> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE chat_threads SET scope_type = ?, scope_id = ?, scope_label = ?, updated_at = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?) AND scope_type IS NULL`,
    args: [
      scope.type,
      scope.id,
      scope.label ?? null,
      Math.max(Date.now(), 1),
      id,
      ownerEmail,
    ],
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return scope;
  }
  return (await getThread(id))?.scope ?? null;
}

/**
 * Detach or rebind a chat's scope. Used by the UI's "Detach from <resource>"
 * action and by templates that need to retag a chat after a rename. Pass
 * `null` to clear the scope (chat becomes general).
 */
export async function setThreadScope(
  id: string,
  ownerEmail: string,
  scope: ChatThreadScope | null,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE chat_threads SET scope_type = ?, scope_id = ?, scope_label = ?, updated_at = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?)`,
    args: [
      scope?.type ?? null,
      scope?.id ?? null,
      scope?.label ?? null,
      Math.max(Date.now(), 1),
      id,
      ownerEmail,
    ],
  });
  emitChatThreadChange(id);
}

export function assertThreadOwner(
  thread: Pick<ChatThread, "ownerEmail">,
  ownerEmail: string,
): void {
  if (
    !ownerEmail?.trim() ||
    thread.ownerEmail.toLowerCase() !== ownerEmail.trim().toLowerCase()
  ) {
    throw new ForbiddenError();
  }
}

async function getOwnedThread(
  id: string,
  ownerEmail: string,
): Promise<ChatThread | null> {
  const thread = await getThread(id);
  if (thread) assertThreadOwner(thread, ownerEmail);
  return thread;
}

export async function renameThread(
  id: string,
  title: string,
  options: {
    ownerEmail: string;
    orgId?: string | null;
    collapseEdits?: boolean;
  },
): Promise<boolean> {
  const nextTitle = normalizeThreadTitle(title);
  if (!nextTitle) return false;
  if (options.collapseEdits) {
    const source = await getOwnedThread(id, options.ownerEmail);
    if (!source) return false;
    let ids: string[] = [];
    const client = getDbExec();
    if (!client.transaction)
      throw new Error("Atomic chat thread rename requires transaction support");
    const renamed = await client.transaction(async (tx) => {
      if (!(await lockEditRoot(tx, source, options.ownerEmail))) return false;
      // Edits acquire the same root lock before insertion. Discover the lineage
      // only after locking so a committed edit cannot be omitted from rename.
      const members = await tx.execute({
        sql: `SELECT sibling.id FROM chat_threads source JOIN chat_threads sibling ON LOWER(sibling.owner_email) = LOWER(source.owner_email) AND sibling.org_id IS NOT DISTINCT FROM source.org_id AND sibling.source_app_id IS NOT DISTINCT FROM source.source_app_id AND sibling.scope_type IS NOT DISTINCT FROM source.scope_type AND sibling.scope_id IS NOT DISTINCT FROM source.scope_id AND COALESCE(sibling.edit_root_id, sibling.id) = COALESCE(source.edit_root_id, source.id) WHERE source.id = ? AND LOWER(source.owner_email) = LOWER(?) AND source.org_id IS NOT DISTINCT FROM ? AND source.source_app_id IS NOT DISTINCT FROM ? AND source.scope_type IS NOT DISTINCT FROM ? AND source.scope_id IS NOT DISTINCT FROM ? AND COALESCE(source.edit_root_id, source.id) = ?`,
        args: [
          id,
          options.ownerEmail,
          source.orgId,
          source.source?.appId ?? null,
          source.scope?.type ?? null,
          source.scope?.id ?? null,
          source.editRootId ?? source.id,
        ],
      });
      ids = members.rows.map((row) => String(row.id));
      if (!ids.length) return false;
      for (const relatedId of ids) {
        const result = await tx.execute({
          sql: `SELECT thread_data, updated_at FROM chat_threads WHERE id = ? AND LOWER(owner_email) = LOWER(?) AND org_id IS NOT DISTINCT FROM ? AND source_app_id IS NOT DISTINCT FROM ? AND scope_type IS NOT DISTINCT FROM ? AND scope_id IS NOT DISTINCT FROM ?`,
          args: [
            relatedId,
            options.ownerEmail,
            source.orgId,
            source.source?.appId ?? null,
            source.scope?.type ?? null,
            source.scope?.id ?? null,
          ],
        });
        const row = result.rows[0];
        if (!row || typeof row.thread_data !== "string")
          throw new Error("Chat thread lineage changed during rename");
        let data: unknown;
        try {
          data = JSON.parse(row.thread_data);
        } catch {
          throw new Error("Invalid chat thread data during rename");
        }
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid chat thread data during rename");
        const nextData = JSON.stringify({ ...data, _titleOverride: nextTitle });
        const updated = await tx.execute({
          sql: `UPDATE chat_threads SET thread_data = ?, title = ?, updated_at = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?) AND org_id IS NOT DISTINCT FROM ? AND source_app_id IS NOT DISTINCT FROM ? AND scope_type IS NOT DISTINCT FROM ? AND scope_id IS NOT DISTINCT FROM ? AND thread_data = ? AND updated_at = ?`,
          args: [
            nextData,
            nextTitle,
            Math.max(Date.now(), Number(row.updated_at) + 1),
            relatedId,
            options.ownerEmail,
            source.orgId,
            source.source?.appId ?? null,
            source.scope?.type ?? null,
            source.scope?.id ?? null,
            row.thread_data,
            row.updated_at,
          ],
        });
        if (updated.rowsAffected !== 1)
          throw new Error("Concurrent chat thread write during rename");
      }
      return true;
    });
    if (!renamed) return false;
    for (const relatedId of ids) emitChatThreadChange(relatedId);
    return true;
  }
  return await withThreadDataLock(id, async () => {
    const thread = await getOwnedThread(id, options.ownerEmail);
    if (!thread) return false;

    const repo = parseThreadData(thread.threadData);
    repo._titleOverride = nextTitle;
    return await updateThreadData(
      id,
      JSON.stringify(repo),
      nextTitle,
      thread.preview,
      thread.messageCount,
    );
  });
}

async function setThreadViewerState(
  id: string,
  field: "pinned_at" | "hidden_at",
  enabled: boolean,
  options: { ownerEmail: string; orgId?: string | null },
): Promise<boolean> {
  const email = normalizeAccessEmail(options.ownerEmail);
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, owner_email FROM chat_threads WHERE id = ?`,
    args: [id],
  });
  const thread = rows[0];
  if (!thread) return false;
  if (!email || normalizeAccessEmail(String(thread.owner_email)) === email) {
    throw new ForbiddenError();
  }
  if (
    !(await hasThreadAccess(email, id, "viewer", {
      orgId:
        (options.orgId === undefined ? getRequestOrgId() : options.orgId) ??
        undefined,
    }))
  ) {
    throw new ForbiddenError();
  }
  const now = Math.max(Date.now(), 1);
  await getDbExec().execute({
    sql: `INSERT INTO chat_thread_viewer_state (thread_id, user_email, ${field}, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (thread_id, user_email) DO UPDATE SET ${field} = EXCLUDED.${field}, updated_at = EXCLUDED.updated_at`,
    args: [id, email, enabled ? now : null, now],
  });
  emitChatThreadChange(id);
  return true;
}

async function editLineageIds(
  id: string,
  ownerEmail: string,
  orgId?: string | null,
): Promise<string[]> {
  const source = await getThread(id);
  if (!source) return [];
  const isOwner =
    normalizeAccessEmail(source.ownerEmail) ===
    normalizeAccessEmail(ownerEmail);
  if (
    !isOwner &&
    !(await hasThreadAccess(
      ownerEmail,
      id,
      "viewer",
      orgId == null ? {} : { orgId },
    ))
  )
    return [];
  const { rows } = await getDbExec().execute({
    sql: `SELECT sibling.id FROM chat_threads source JOIN chat_threads sibling ON LOWER(sibling.owner_email) = LOWER(source.owner_email) AND sibling.org_id IS NOT DISTINCT FROM source.org_id AND sibling.source_app_id IS NOT DISTINCT FROM source.source_app_id AND sibling.scope_type IS NOT DISTINCT FROM source.scope_type AND sibling.scope_id IS NOT DISTINCT FROM source.scope_id AND COALESCE(sibling.edit_root_id, sibling.id) = COALESCE(source.edit_root_id, source.id) WHERE source.id = ?`,
    args: [id],
  });
  const result: string[] = [];
  for (const row of rows) {
    const relatedId = String(row.id);
    if (
      isOwner ||
      relatedId === id ||
      (await hasThreadAccess(
        ownerEmail,
        relatedId,
        "viewer",
        orgId == null ? {} : { orgId },
      ))
    )
      result.push(relatedId);
  }
  return result;
}

export async function setThreadPinned(
  id: string,
  pinned: boolean,
  options: {
    ownerEmail: string;
    orgId?: string | null;
    collapseEdits?: boolean;
  },
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  if (options.collapseEdits) {
    let changed = false;
    for (const relatedId of await editLineageIds(
      id,
      options.ownerEmail,
      options.orgId,
    )) {
      changed =
        (await setThreadPinned(relatedId, pinned, {
          ownerEmail: options.ownerEmail,
          ...(options.orgId === undefined ? {} : { orgId: options.orgId }),
        })) || changed;
    }
    return changed;
  }
  const now = Math.max(Date.now(), 1);
  const result = await client.execute({
    sql: `UPDATE chat_threads SET pinned_at = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?)`,
    args: [pinned ? now : null, id, options.ownerEmail.trim()],
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return true;
  }
  return setThreadViewerState(id, "pinned_at", pinned, options);
}

export async function setThreadHidden(
  id: string,
  hidden: boolean,
  options: {
    ownerEmail: string;
    orgId?: string | null;
    collapseEdits?: boolean;
  },
): Promise<boolean> {
  await ensureTable();
  if (options.collapseEdits) {
    let changed = false;
    for (const relatedId of await editLineageIds(
      id,
      options.ownerEmail,
      options.orgId,
    )) {
      changed =
        (await setThreadViewerState(relatedId, "hidden_at", hidden, options)) ||
        changed;
    }
    return changed;
  }
  return setThreadViewerState(id, "hidden_at", hidden, options);
}

export async function setThreadArchived(
  id: string,
  archived: boolean,
  options: {
    ownerEmail: string;
    orgId?: string | null;
    collapseEdits?: boolean;
  },
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  if (options.collapseEdits) {
    // Archiving is owner-only even if the selected thread is shared.
    const source = await getOwnedThread(id, options.ownerEmail);
    if (!source) return false;
    let changed = false;
    for (const relatedId of await editLineageIds(
      id,
      options.ownerEmail,
      options.orgId,
    )) {
      changed =
        (await setThreadArchived(relatedId, archived, {
          ownerEmail: options.ownerEmail,
        })) || changed;
    }
    return changed;
  }
  const now = Math.max(Date.now(), 1);
  const result = await client.execute({
    sql: `UPDATE chat_threads SET archived_at = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?)`,
    args: [archived ? now : null, id, options.ownerEmail.trim()],
  });
  if (result.rowsAffected > 0) {
    emitChatThreadChange(id);
    return true;
  }
  await getOwnedThread(id, options.ownerEmail);
  return false;
}

export interface UpdateThreadDataOptions {
  preserveExistingQueuedMessages?: boolean;
  preserveExistingTopLevelKeys?: boolean;
  preserveCurrentMetadata?: boolean;
  /**
   * Preserve the title and its override from each current CAS revision; a
   * blank title still fills from the merged visible prompts.
   */
  preserveCurrentTitle?: boolean;
  preserveCurrentTitleAndPreview?: boolean;
  trustedRunSequenceResetIds?: ReadonlySet<string>;
  onAnnotationConflict?: (conflict: ThreadAnnotationSnapshotConflict) => void;
  beforeUpdate?: (tx: DbExec) => Promise<boolean>;
  afterUpdate?: (tx: DbExec) => Promise<void>;
  transformThreadData?: (
    currentThreadData: string,
  ) => string | { threadData: string; preview?: string };
  maxAttempts?: number;
  ignoreConflicts?: boolean;
}

export class InlineAttachmentDataNotPersistableError extends Error {
  readonly code = "inline_attachment_data_not_persistable";

  constructor(
    message = "Inline attachment data cannot be stored in chat history.",
  ) {
    super(message);
    this.name = "InlineAttachmentDataNotPersistableError";
  }
}

function assertPersistableThreadData(threadData: string, label: string): void {
  try {
    assertNoInlineImageBytes(threadData, label);
  } catch (error) {
    throw new InlineAttachmentDataNotPersistableError(
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseThreadData(value: string): any {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

/**
 * Replace a thread's data through the same compare-and-set write `renameThread`
 * uses, without the client-save merge.
 *
 * `updateThreadData` is a client-save writer: it normalises the incoming data and
 * unions the message arrays, so a caller that has *removed* messages gets them
 * back. A deletion (or any write that must be authoritative) passes a transform
 * here instead; the transform receives the freshly read data and returns the
 * whole next document, or null to leave the thread untouched. Conflicts retry
 * against a fresh read, so a concurrent append is never lost.
 */
export async function replaceThreadData(
  id: string,
  ownerEmail: string,
  transform: (
    current: Record<string, unknown>,
  ) => Record<string, unknown> | null,
  options: {
    messageCount?: (next: Record<string, unknown>) => number;
    maxAttempts?: number;
  } = {},
): Promise<boolean> {
  const client = getDbExec();
  const attempts = Math.max(1, options.maxAttempts ?? 12);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const thread = await getThread(id);
    if (
      !thread ||
      thread.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase()
    ) {
      return false;
    }
    let current: Record<string, unknown>;
    try {
      const parsed = JSON.parse(thread.threadData || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false;
      }
      current = parsed as Record<string, unknown>;
      // coercion-ok: unparseable thread_data is never overwritten; false means not replaced
    } catch {
      return false;
    }
    const next = transform(current);
    if (!next) return false;
    const nextCount =
      options.messageCount?.(next) ??
      (Array.isArray(next.messages)
        ? next.messages.length
        : thread.messageCount);
    const result = await client.execute({
      sql: `UPDATE chat_threads SET thread_data = ?, updated_at = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?) AND org_id IS NOT DISTINCT FROM ? AND source_app_id IS NOT DISTINCT FROM ? AND scope_type IS NOT DISTINCT FROM ? AND scope_id IS NOT DISTINCT FROM ? AND thread_data = ? AND updated_at = ?`,
      args: [
        JSON.stringify(next),
        Math.max(Date.now(), Number(thread.updatedAt) + 1),
        id,
        ownerEmail,
        thread.orgId ?? null,
        thread.source?.appId ?? null,
        thread.scope?.type ?? null,
        thread.scope?.id ?? null,
        thread.threadData,
        thread.updatedAt,
      ],
    });
    if (result.rowsAffected === 1) {
      try {
        await client.execute({
          sql: `UPDATE chat_threads SET message_count = ? WHERE id = ?`,
          args: [nextCount, id],
        });
        // coercion-ok: best-effort message_count refresh after the thread_data write committed
      } catch {
        // The data write landed; a count refresh failure surfaces in the readback.
      }
      emitChatThreadChange(id);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function updateThreadData(
  id: string,
  threadData: string,
  title: string,
  preview: string,
  messageCount: number,
  options: UpdateThreadDataOptions = {},
): Promise<boolean> {
  // getThread() ensures the table exists. Keep that bootstrap inside the
  // retry boundary below so a cold serverless process can recover from a
  // transient initialization/read failure too.
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
      if (!current) return false;

      const safeCurrentThreadData = stripInlineBytes(
        parseThreadData(current.threadData),
        "placeholder",
      );
      const transformed = options.transformThreadData?.(
        JSON.stringify(safeCurrentThreadData),
      );
      const incomingThreadData =
        typeof transformed === "string"
          ? transformed
          : (transformed?.threadData ?? threadData);
      let nextThreadData = incomingThreadData;
      let nextMessageCount = messageCount;
      const annotationConflicts: ThreadAnnotationSnapshotConflict[] = [];
      const merged = mergeThreadDataForClientSave(
        safeCurrentThreadData,
        parseThreadData(incomingThreadData),
        {
          preserveExistingQueuedMessages:
            options.preserveExistingQueuedMessages ?? true,
          preserveExistingTopLevelKeys:
            options.preserveExistingTopLevelKeys ?? true,
          trustedRunSequenceResetIds: options.trustedRunSequenceResetIds,
          onAnnotationConflict: (conflict) =>
            annotationConflicts.push(conflict),
        },
      );
      if (options.preserveCurrentTitle) {
        if (
          Object.prototype.hasOwnProperty.call(
            safeCurrentThreadData,
            "_titleOverride",
          )
        ) {
          merged._titleOverride = safeCurrentThreadData._titleOverride;
        } else {
          delete merged._titleOverride;
        }
      }
      // Client snapshots can predate their upload URL, so inline bytes become a
      // visible placeholder rather than failing the save; legacy rows are
      // scrubbed on their next write.
      nextThreadData = JSON.stringify(stripInlineBytes(merged, "placeholder"));
      assertPersistableThreadData(nextThreadData, "thread_data");
      nextMessageCount = countThreadMessages(merged, messageCount);

      const nextUpdatedAt = Math.max(Date.now(), current.updatedAt + 1);
      // Completion persistence can race the separate generated-title save.
      // Keep a title already committed by that save when this caller only has
      // its stale empty snapshot.
      const preserveCurrentMetadata = options.preserveCurrentMetadata;
      const preserveCurrentTitleAndPreview =
        options.preserveCurrentTitleAndPreview;
      const snapshotMetaForBlankFields =
        !options.preserveCurrentMetadata &&
        (options.preserveCurrentTitleAndPreview ||
          options.preserveCurrentTitle) &&
        (!current.title.trim() || !current.preview.trim())
          ? extractThreadMeta(merged)
          : undefined;
      const nextTitle = preserveCurrentMetadata
        ? current.title
        : preserveCurrentTitleAndPreview || options.preserveCurrentTitle
          ? current.title.trim()
            ? current.title
            : snapshotMetaForBlankFields?.title || current.title
          : title || current.title || extractThreadMeta(merged).title;
      const nextPreview = preserveCurrentMetadata
        ? current.preview
        : preserveCurrentTitleAndPreview
          ? current.preview.trim()
            ? current.preview
            : snapshotMetaForBlankFields?.preview || current.preview
          : typeof transformed === "object" && transformed.preview !== undefined
            ? transformed.preview
            : preview;
      let beforeUpdateRejected = false;
      const write = async (tx: DbExec) => {
        if (options.beforeUpdate && !(await options.beforeUpdate(tx))) {
          beforeUpdateRejected = true;
          return { rows: [], rowsAffected: 0 };
        }
        const result = await tx.execute({
          sql: `UPDATE chat_threads SET thread_data = ?, title = ?, preview = ?, message_count = COALESCE(?, message_count), updated_at = ? WHERE id = ? AND updated_at = ? AND LOWER(owner_email) = LOWER(?)`,
          args: [
            nextThreadData,
            nextTitle,
            nextPreview,
            options.preserveCurrentMetadata ? null : nextMessageCount,
            nextUpdatedAt,
            id,
            current.updatedAt,
            current.ownerEmail,
          ],
        });
        if (result.rowsAffected > 0) await options.afterUpdate?.(tx);
        return result;
      };
      const fence = currentExecutionFence();
      const result = fence
        ? await withFencedExecutionWrite(write, { threadId: id })
        : options.beforeUpdate || options.afterUpdate
          ? client.transaction
            ? await client.transaction(write)
            : (() => {
                throw new Error(
                  "Atomic thread-data callbacks require transaction support",
                );
              })()
          : await withFencedExecutionWrite(write, { threadId: id });

      if (beforeUpdateRejected) return false;

      if (result.rowsAffected > 0) {
        for (const conflict of annotationConflicts) {
          options.onAnnotationConflict?.(conflict);
        }
        emitChatThreadChange(id);
        return true;
      }

      lastConflict = true;
    } catch (error) {
      if (error instanceof QueuedSubmissionAdmissionError) throw error;
      if (error instanceof InlineAttachmentDataNotPersistableError) {
        throw error;
      }
      // Completion saves happen after a long model/tool turn, when a
      // transient connection or serverless DB failure is especially costly.
      // Retry the whole read/merge/write attempt like a CAS conflict, while
      // preserving the final error if the database remains unavailable.
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
    if (options.ignoreConflicts) return false;
    const error = new Error(
      `Failed to update chat thread ${id} after concurrent write conflicts.`,
    ) as Error & { statusCode?: number; statusMessage?: string };
    error.statusCode = 409;
    error.statusMessage = error.message;
    throw error;
  }

  return false;
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
  threadId?: string;
  createdAt?: string;
  attachments?: unknown[];
  requestAttachments?: unknown[];
  references?: AgentSubmissionReference[];
  metadata?: Record<string, unknown>;
  options?: AgentRunOptions;
  interruptActiveRun?: boolean;
  promotionClaim?: { id: string; expiresAt: number };
  /**
   * Send now was pressed during a run: `steering` waits for the run's next
   * tool boundary, `after_reply` sends as the next turn. Thread state only,
   * never part of the admitted payload.
   */
  delivery?: QueuedMessageDelivery;
}

export type QueuedMessageDelivery = "steering" | "after_reply";

export type QueuedSubmissionState =
  | "queued"
  | "submitted"
  | "removed"
  | "expired"
  | "blocked";

export interface QueuedSubmissionActor {
  email: string;
  authUserId?: string;
  identityAuthenticatedAtMs?: number;
  name?: string;
  orgId?: string | null;
  orgScope?: "personal" | null;
  anonymous?: boolean;
}

export interface QueuedSubmissionReceipt {
  threadId: string;
  messageId: string;
  state: QueuedSubmissionState;
  actor: QueuedSubmissionActor;
  message?: QueuedMessage;
  payloadHash: string;
  submittedRunId?: string;
  interruptRunId?: string;
  retryAfter?: number;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export class QueuedSubmissionAdmissionError extends Error {
  constructor(
    readonly code:
      | "queued_message_already_submitted"
      | "queued_message_id_conflict"
      | "queued_message_id_terminal",
    messageId: string,
    readonly submittedRunId?: string,
  ) {
    super(`Queued message ${messageId} cannot be admitted: ${code}`);
    this.name = "QueuedSubmissionAdmissionError";
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function hashQueuedSubmissionPayload(
  threadId: string,
  message: QueuedMessage | AgentSubmissionPayload,
): string {
  const normalizeMetadata = (
    metadata: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (!metadata) return undefined;
    const custom = metadata.custom;
    if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
      return metadata;
    }
    const stableCustom = { ...(custom as Record<string, unknown>) };
    delete stableCustom[AGENT_NATIVE_SUBMISSION_TTL_MS_METADATA_KEY];
    delete stableCustom[AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY];
    return { ...metadata, custom: stableCustom };
  };
  const {
    createdAt: _createdAt,
    promotionClaim: _claim,
    delivery: _delivery,
    ...payload
  } = message as QueuedMessage;
  const options = payload.options as AgentRunOptions | undefined;
  const stablePayload = {
    ...payload,
    threadId,
    ...(payload.metadata
      ? { metadata: normalizeMetadata(payload.metadata) }
      : {}),
    ...(options?.metadata
      ? {
          options: {
            ...options,
            metadata: normalizeMetadata(options.metadata),
          },
        }
      : {}),
  };
  return crypto
    .createHash("sha256")
    .update(stableJson(stablePayload))
    .digest("hex");
}

export function queuedSubmissionBehaviorMatches(
  threadId: string,
  message: QueuedMessage,
  identity: AgentSubmissionPayload,
): boolean {
  const {
    attachments: _attachments,
    requestAttachments: _requestAttachments,
    ...messageBehavior
  } = message;
  const {
    attachments: _identityAttachments,
    requestAttachments: _identityRequestAttachments,
    ...identityBehavior
  } = identity;
  return (
    hashQueuedSubmissionPayload(threadId, messageBehavior) ===
    hashQueuedSubmissionPayload(threadId, identityBehavior)
  );
}

function normalizeQueuedSubmissionActor(
  actor: QueuedSubmissionActor,
): QueuedSubmissionActor {
  const email = actor.email.trim();
  if (!email) throw new TypeError("Queued message actor email is required.");
  return {
    email,
    ...(actor.authUserId ? { authUserId: actor.authUserId } : {}),
    ...(actor.identityAuthenticatedAtMs !== undefined
      ? { identityAuthenticatedAtMs: actor.identityAuthenticatedAtMs }
      : {}),
    ...(actor.name ? { name: actor.name } : {}),
    ...(actor.orgId !== undefined ? { orgId: actor.orgId } : {}),
    ...(actor.orgScope ? { orgScope: actor.orgScope } : {}),
    anonymous: actor.anonymous === true,
  };
}

function queuedSubmissionActorMatches(
  left: QueuedSubmissionActor,
  right: QueuedSubmissionActor,
): boolean {
  return (
    left.email.trim().toLowerCase() === right.email.trim().toLowerCase() &&
    (left.authUserId ?? null) === (right.authUserId ?? null) &&
    (left.orgId ?? null) === (right.orgId ?? null) &&
    (left.orgScope ?? null) === (right.orgScope ?? null) &&
    (left.anonymous === true) === (right.anonymous === true)
  );
}

function queuedSubmissionReceiptFromRow(
  row: Record<string, unknown>,
): QueuedSubmissionReceipt {
  const threadId = String(row.thread_id ?? "");
  const messageId = String(row.message_id ?? "");
  const state = String(row.state ?? "");
  if (
    !threadId ||
    !messageId ||
    !["queued", "submitted", "removed", "expired", "blocked"].includes(state)
  ) {
    throw new TypeError("Stored queued submission receipt is malformed.");
  }
  let message: QueuedMessage | undefined;
  if (typeof row.payload_json === "string") {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).id === "string" &&
      typeof (parsed as Record<string, unknown>).text === "string"
    ) {
      message = parsed as QueuedMessage;
    }
  }
  const orgId = row.actor_org_id;
  const orgScope = row.actor_org_scope;
  const retryCount = Number(row.retry_count);
  if (!Number.isSafeInteger(retryCount) || retryCount < 0) {
    throw new TypeError("Stored queued submission retry count is malformed.");
  }
  return {
    threadId,
    messageId,
    state: state as QueuedSubmissionState,
    actor: {
      email: String(row.actor_email ?? ""),
      ...(typeof row.actor_auth_user_id === "string"
        ? { authUserId: row.actor_auth_user_id }
        : {}),
      ...(row.actor_identity_authenticated_at_ms != null
        ? {
            identityAuthenticatedAtMs: Number(
              row.actor_identity_authenticated_at_ms,
            ),
          }
        : {}),
      ...(typeof row.actor_name === "string" ? { name: row.actor_name } : {}),
      ...(typeof orgId === "string" ? { orgId } : {}),
      ...(orgScope === "personal" ? { orgScope: "personal" as const } : {}),
      anonymous: row.actor_anonymous === true,
    },
    ...(message ? { message } : {}),
    payloadHash: String(row.payload_hash ?? ""),
    ...(typeof row.submitted_run_id === "string"
      ? { submittedRunId: row.submitted_run_id }
      : {}),
    ...(typeof row.interrupt_run_id === "string"
      ? { interruptRunId: row.interrupt_run_id }
      : {}),
    ...(row.retry_after != null ? { retryAfter: Number(row.retry_after) } : {}),
    retryCount,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const QUEUED_SUBMISSION_COLUMNS = `thread_id, message_id, state, actor_email, actor_auth_user_id, actor_identity_authenticated_at_ms, actor_name, actor_org_id, actor_org_scope, actor_anonymous, payload_hash, payload_json, submitted_run_id, interrupt_run_id, retry_after, retry_count, created_at, updated_at`;

async function readQueuedSubmissionReceipt(
  db: DbExec,
  threadId: string,
  messageId: string,
  options: { forUpdate?: boolean } = {},
): Promise<QueuedSubmissionReceipt | null> {
  const { rows } = await db.execute({
    sql: `SELECT ${QUEUED_SUBMISSION_COLUMNS} FROM agent_chat_submission_inbox WHERE thread_id = ? AND message_id = ?${options.forUpdate ? " FOR UPDATE" : ""}`,
    args: [threadId, messageId],
  });
  return rows[0]
    ? queuedSubmissionReceiptFromRow(rows[0] as Record<string, unknown>)
    : null;
}

function queuedSubmissionReceiptSnapshotMatches(
  current: QueuedSubmissionReceipt | null,
  expected: QueuedSubmissionReceipt,
): boolean {
  return Boolean(
    current?.state === "queued" &&
    expected.state === "queued" &&
    current.payloadHash === expected.payloadHash &&
    stableJson(current.actor) === stableJson(expected.actor) &&
    current.message &&
    expected.message &&
    stableJson(current.message) === stableJson(expected.message),
  );
}

function assertQueuedSubmissionReceiptSnapshotMatches(
  current: QueuedSubmissionReceipt | null,
  expected: QueuedSubmissionReceipt,
): void {
  if (!current || current.state !== "queued") {
    throw new QueuedSubmissionAdmissionError(
      current?.state === "submitted"
        ? "queued_message_already_submitted"
        : "queued_message_id_terminal",
      expected.messageId,
      current?.submittedRunId,
    );
  }
  if (!queuedSubmissionReceiptSnapshotMatches(current, expected)) {
    throw new QueuedSubmissionAdmissionError(
      "queued_message_id_conflict",
      expected.messageId,
    );
  }
}

/** Returns the durable admission receipt used to dedupe direct starts and queue retries. */
export async function getQueuedSubmissionReceipt(
  threadId: string,
  messageId: string,
): Promise<QueuedSubmissionReceipt | null> {
  await ensureTable();
  return readQueuedSubmissionReceipt(getDbExec(), threadId, messageId);
}

export async function getQueuedSubmissionReceiptStatus(
  threadId: string,
  messageId: string,
): Promise<{ state: QueuedSubmissionState; submittedRunId?: string } | null> {
  const receipt = await getQueuedSubmissionReceipt(threadId, messageId);
  if (!receipt) return null;
  if (receipt.state === "queued" && !receipt.message) {
    throw new TypeError("Stored queued submission receipt has no message.");
  }
  if (receipt.state === "submitted" && !receipt.submittedRunId) {
    throw new TypeError(
      "Stored submitted receipt has no submitted run identifier.",
    );
  }
  const queuedMessage =
    receipt.state === "queued" ? receipt.message : undefined;
  return {
    state:
      receipt.state === "queued" &&
      queuedMessage &&
      queuedSubmissionExpired(queuedMessage, Date.now())
        ? "expired"
        : receipt.state,
    ...(receipt.submittedRunId
      ? { submittedRunId: receipt.submittedRunId }
      : {}),
  };
}

/** Checks the inbox inside a caller's transaction before a fresh run claims its slot. */
export async function hasPendingQueuedSubmissionReceipt(
  tx: DbExec,
  threadId: string,
): Promise<boolean> {
  await ensureTable();
  const { rows } = await tx.execute({
    sql: `SELECT message_id, payload_json FROM agent_chat_submission_inbox
          WHERE thread_id = ? AND state = 'queued'
          ORDER BY created_at ASC, message_id ASC
          LIMIT ?`,
    args: [threadId, MAX_QUEUED_RECEIPTS_TO_CHECK_FOR_RUN_BARRIER + 1],
  });
  // Unread rows may still contain a live barrier, so keep admission closed.
  if (rows.length > MAX_QUEUED_RECEIPTS_TO_CHECK_FOR_RUN_BARRIER) return true;
  const now = Date.now();
  return rows.some((row) => {
    const messageId = String(row.message_id ?? "");
    if (typeof row.payload_json !== "string") {
      throw new TypeError("Stored queued submission receipt has no message.");
    }
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (
      !messageId ||
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      typeof (parsed as Record<string, unknown>).text !== "string" ||
      (parsed as Record<string, unknown>).id !== messageId
    ) {
      throw new TypeError(
        "Stored queued submission receipt has a malformed message.",
      );
    }
    return !queuedSubmissionExpired(parsed as QueuedMessage, now);
  });
}

/** Finds accepted queue rows in priority order for the signed server sweep. */
export async function listQueuedSubmissionReceipts(
  options: {
    limit?: number;
    now?: number;
    threadId?: string;
    interruptActiveRun?: boolean;
  } = {},
): Promise<QueuedSubmissionReceipt[]> {
  await ensureTable();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const now = options.now ?? Date.now();
  const where = ["current.state = 'queued'"];
  const args: (number | string)[] = [now];
  where.push("(current.retry_after IS NULL OR current.retry_after <= ?)");
  where.push(`NOT EXISTS (
    SELECT 1 FROM agent_chat_submission_inbox AS earlier
    WHERE earlier.thread_id = current.thread_id
      AND earlier.state = 'queued'
      AND earlier.retry_after > ?
      AND (
        earlier.interrupt_active_run > current.interrupt_active_run
        OR (
          earlier.interrupt_active_run = current.interrupt_active_run
          AND (
            (earlier.move_to_top_at IS NOT NULL AND current.move_to_top_at IS NULL)
            OR earlier.move_to_top_at > current.move_to_top_at
            OR (
              (earlier.move_to_top_at = current.move_to_top_at
                OR (earlier.move_to_top_at IS NULL AND current.move_to_top_at IS NULL))
              AND earlier.queue_order < current.queue_order
            )
          )
        )
      )
  )`);
  args.push(now);
  if (options.threadId) {
    where.push("current.thread_id = ?");
    args.push(options.threadId);
  }
  if (options.interruptActiveRun === true) {
    where.push("current.interrupt_active_run = TRUE");
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${QUEUED_SUBMISSION_COLUMNS} FROM agent_chat_submission_inbox AS current
          WHERE ${where.join(" AND ")}
          ORDER BY current.interrupt_active_run DESC, current.move_to_top_at DESC NULLS LAST, current.queue_order ASC
          LIMIT ?`,
    args: [...args, limit],
  });
  return rows.map((row) =>
    queuedSubmissionReceiptFromRow(row as Record<string, unknown>),
  );
}

/** Records a run admission in the same transaction that persists its user message. */
export async function markQueuedSubmissionSubmitted(
  tx: DbExec,
  input: {
    threadId: string;
    messageId: string;
    runId?: string;
    actor: QueuedSubmissionActor;
    message?: QueuedMessage;
    hashInput?: AgentSubmissionPayload;
  },
): Promise<void> {
  const { threadId, messageId, runId } = input;
  const actor = normalizeQueuedSubmissionActor(input.actor);
  const existing = await readQueuedSubmissionReceipt(tx, threadId, messageId);
  const payloadHash = input.hashInput
    ? hashQueuedSubmissionPayload(threadId, input.hashInput)
    : input.message
      ? hashQueuedSubmissionPayload(threadId, input.message)
      : undefined;
  if (existing) {
    if (!queuedSubmissionActorMatches(existing.actor, actor)) {
      throw new QueuedSubmissionAdmissionError(
        "queued_message_id_conflict",
        messageId,
      );
    }
    if (
      payloadHash &&
      existing.state !== "queued" &&
      existing.payloadHash !== payloadHash
    ) {
      throw new QueuedSubmissionAdmissionError(
        "queued_message_id_conflict",
        messageId,
      );
    }
    if (
      payloadHash &&
      existing.state === "queued" &&
      input.hashInput &&
      existing.payloadHash !== payloadHash
    ) {
      throw new QueuedSubmissionAdmissionError(
        "queued_message_id_conflict",
        messageId,
      );
    }
    if (existing.state === "submitted") {
      if (
        runId &&
        existing.submittedRunId &&
        existing.submittedRunId !== runId
      ) {
        throw new QueuedSubmissionAdmissionError(
          "queued_message_already_submitted",
          messageId,
          existing.submittedRunId,
        );
      }
      return;
    }
    if (existing.state !== "queued") {
      throw new QueuedSubmissionAdmissionError(
        "queued_message_id_terminal",
        messageId,
      );
    }
    const update = await tx.execute({
      sql: `UPDATE agent_chat_submission_inbox SET state = 'submitted', submitted_run_id = COALESCE(?, submitted_run_id), interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
      args: [runId ?? null, Date.now(), threadId, messageId],
    });
    if (update.rowsAffected > 0) return;

    const raced = await readQueuedSubmissionReceipt(tx, threadId, messageId);
    if (raced?.state === "submitted") {
      if (runId && raced.submittedRunId && raced.submittedRunId !== runId) {
        throw new QueuedSubmissionAdmissionError(
          "queued_message_already_submitted",
          messageId,
          raced.submittedRunId,
        );
      }
      return;
    }
    throw new QueuedSubmissionAdmissionError(
      "queued_message_id_terminal",
      messageId,
    );
  }
  const now = Date.now();
  const message = input.message
    ? { ...input.message, threadId: input.message.threadId ?? threadId }
    : undefined;
  const storedMessage = message
    ? stripInlineBytes(message, "placeholder")
    : undefined;
  await tx.execute({
    sql: `INSERT INTO agent_chat_submission_inbox
      (thread_id, message_id, state, actor_email, actor_auth_user_id, actor_identity_authenticated_at_ms, actor_name, actor_org_id, actor_org_scope, actor_anonymous, payload_hash, payload_json, interrupt_active_run, submitted_run_id, created_at, updated_at)
      VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      threadId,
      messageId,
      actor.email,
      actor.authUserId ?? null,
      actor.identityAuthenticatedAtMs ?? null,
      actor.name ?? null,
      actor.orgId ?? null,
      actor.orgScope ?? null,
      actor.anonymous === true,
      payloadHash ??
        (message
          ? hashQueuedSubmissionPayload(threadId, message)
          : crypto
              .createHash("sha256")
              .update(`submitted:${messageId}`)
              .digest("hex")),
      JSON.stringify(storedMessage ?? { id: messageId, threadId }),
      message?.interruptActiveRun === true,
      runId ?? null,
      now,
      now,
    ],
  });
}

/** Delays a retryable drain failure without releasing the accepted submission. */
export async function retryQueuedSubmissionReceipt(
  threadId: string,
  messageId: string,
  retryAfter: number,
  options: { claimId?: string; countRetry?: boolean } = {},
): Promise<boolean> {
  await ensureTable();
  const result = await mutateThreadQueuedMessages(threadId, {
    type: "retryReceipt",
    messageId,
    retryAfter,
    ...(options.claimId ? { claimId: options.claimId } : {}),
    ...(options.countRetry ? { countRetry: true } : {}),
  });
  return result?.receiptUpdated === true;
}

/**
 * True when a queued receipt on this thread was moved to the head, which Send
 * now does. Lets a run check its tool boundaries without reading thread data.
 */
export async function hasPrioritizedQueuedSubmission(
  threadId: string,
): Promise<boolean> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM agent_chat_submission_inbox
          WHERE thread_id = ? AND state = 'queued' AND move_to_top_at IS NOT NULL
          LIMIT 1`,
    args: [threadId],
  });
  return rows.length > 0;
}

async function hasQueuedDelivery(
  threadId: string,
  deliveries: readonly QueuedMessageDelivery[],
): Promise<boolean> {
  const thread = await getThread(threadId);
  if (!thread) return false;
  const queued = parseThreadData(thread.threadData || "{}")?.queuedMessages;
  return (
    Array.isArray(queued) &&
    queued.some((message: unknown) => {
      const delivery = (message as QueuedMessage | null)?.delivery;
      return delivery !== undefined && deliveries.includes(delivery);
    })
  );
}

/**
 * Takes every Send now message off the queue for delivery into `runId`, and
 * marks each admitted receipt submitted to that run in the same transaction,
 * so the inbox can never also start it as a new turn.
 */
export async function claimSteeredQueuedMessages(
  threadId: string,
  runId: string,
): Promise<
  Array<{ queued: QueuedMessage; record: SteeredQueuedMessageRecord }>
> {
  if (
    !(await hasPrioritizedQueuedSubmission(threadId)) ||
    !(await hasQueuedDelivery(threadId, ["steering", "after_reply"]))
  ) {
    return [];
  }
  const result = await mutateThreadQueuedMessages(threadId, {
    type: "claimSteered",
    runId,
  });
  const records = result?.steeredRecords ?? [];
  return (result?.steeredMessages ?? []).map((queued, index) => {
    const record = records.at(index);
    if (record?.message.id !== queued.id) {
      throw new TypeError("Steered queue claim lost its delivery record.");
    }
    return { queued, record };
  });
}

/** Marks Send now messages that missed the run's last tool boundary. */
export async function deferSteeredQueuedMessages(
  threadId: string,
): Promise<void> {
  if (
    !(await hasPrioritizedQueuedSubmission(threadId)) ||
    !(await hasQueuedDelivery(threadId, ["steering"]))
  ) {
    return;
  }
  await mutateThreadQueuedMessages(threadId, { type: "deferSteered" });
}

/** Retains but stops automatically promoting a row that can no longer be authorized. */
export async function blockQueuedSubmissionReceipt(
  threadId: string,
  messageId: string,
  options: { claimId?: string } = {},
): Promise<boolean> {
  await ensureTable();
  const result = await mutateThreadQueuedMessages(threadId, {
    type: "blockReceipt",
    messageId,
    ...(options.claimId ? { claimId: options.claimId } : {}),
  });
  return result?.receiptUpdated === true;
}

async function mutateQueuedSubmissionInterruptRun(
  input: {
    threadId: string;
    messageId: string;
    runId: string;
    claimId: string;
  },
  operation: "record" | "clear",
): Promise<boolean> {
  const result = await mutateThreadQueuedMessages(input.threadId, {
    type: operation === "record" ? "recordInterruptRun" : "clearInterruptRun",
    messageId: input.messageId,
    runId: input.runId,
    claimId: input.claimId,
  });
  return result?.receiptUpdated === true;
}

/** Persist the active run before interrupting it so a later inbox claim can finish the abort. */
export async function recordQueuedSubmissionInterruptRun(input: {
  threadId: string;
  messageId: string;
  runId: string;
  claimId: string;
}): Promise<boolean> {
  return mutateQueuedSubmissionInterruptRun(input, "record");
}

/** Renews a queued submission's live promotion claim during admission. */
export async function renewQueuedSubmissionClaim(input: {
  threadId: string;
  messageId: string;
  claimId: string;
  runId?: string;
  renewUntil?: number;
}): Promise<boolean> {
  // raw-sql-ok: the queue store binds the mutation fields as SQL parameters.
  const result = await mutateThreadQueuedMessages(input.threadId, {
    type: "renewClaim",
    messageId: input.messageId,
    claimId: input.claimId,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.renewUntil === undefined ? {} : { renewUntil: input.renewUntil }),
  });
  return (
    result?.claimLost !== true &&
    result?.claimedMessage?.promotionClaim?.id === input.claimId
  );
}

/** Renews a live interruption claim before its recorded run is aborted. */
export async function renewQueuedSubmissionInterruptClaim(input: {
  threadId: string;
  messageId: string;
  runId: string;
  claimId: string;
}): Promise<boolean> {
  return renewQueuedSubmissionClaim(input);
}

/** Clear a recorded interruption only after its turn abort is durable. */
export async function clearQueuedSubmissionInterruptRun(input: {
  threadId: string;
  messageId: string;
  runId: string;
  claimId: string;
}): Promise<boolean> {
  return mutateQueuedSubmissionInterruptRun(input, "clear");
}

export type ThreadQueuedMessageMutation =
  | {
      type: "append";
      message: QueuedMessage;
      hashInput?: AgentSubmissionPayload;
    }
  | { type: "remove"; messageId: string }
  | { type: "cancel"; messageId: string }
  | { type: "moveToTop"; messageId: string }
  | { type: "steer"; messageId: string }
  | { type: "claimSteered"; runId: string }
  | { type: "deferSteered" }
  | { type: "reorder"; messageIds: readonly string[] }
  | { type: "claim"; messageId: string; claimId: string }
  | {
      type: "claimFromInbox";
      receipt: QueuedSubmissionReceipt;
      claimId: string;
    }
  | {
      type: "retryReceipt";
      messageId: string;
      retryAfter: number;
      claimId?: string;
      countRetry?: boolean;
    }
  | { type: "blockReceipt"; messageId: string; claimId?: string }
  | {
      type: "recordInterruptRun" | "clearInterruptRun";
      messageId: string;
      runId: string;
      claimId: string;
    }
  | {
      type: "renewClaim";
      messageId: string;
      runId?: string;
      renewUntil?: number;
      claimId: string;
    }
  | { type: "release"; messageId: string; claimId: string };

export interface ThreadQueuedMessageMutationResult {
  queuedMessages: QueuedMessage[];
  message?: QueuedMessage;
  /** A claim check that loses the claim clears this to undefined. */
  claimedMessage?: QueuedMessage | undefined;
  alreadySubmitted?: boolean;
  submittedRunId?: string;
  claimBusy?: boolean | undefined;
  submissionExpired?: boolean;
  promotionBusy?: boolean;
  /** A reorder named a different message set than the queue holds. */
  queueOrderStale?: boolean;
  receiptManaged?: boolean;
  receiptUnavailable?: boolean;
  retryDeferred?: boolean;
  receiptConflict?: boolean;
  receiptUpdated?: boolean;
  claimLost?: boolean;
  released?: boolean;
  /** Messages a run took from the queue at a tool boundary. */
  steeredMessages?: QueuedMessage[];
  steeredRecords?: SteeredQueuedMessageRecord[];
}

const QUEUED_MESSAGE_CLAIM_TTL_MS = 60_000;

function queuedMessageClaimActive(message: QueuedMessage, now: number) {
  return (
    message.promotionClaim !== undefined &&
    message.promotionClaim.expiresAt > now
  );
}

function receiptMutationOwnsPromotionClaim(
  message: QueuedMessage | undefined,
  claimId: string | undefined,
  now: number,
): boolean {
  const claim = message?.promotionClaim as unknown;
  if (claim === undefined || claim === null) return claimId === undefined;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
  const value = claim as { id?: unknown; expiresAt?: unknown };
  if (
    typeof value.id !== "string" ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt)
  ) {
    return false;
  }
  const active = value.expiresAt > now;
  return claimId === undefined ? !active : value.id === claimId && active;
}

function submittedQueuedMessageRunId(
  repository: Record<string, unknown>,
  messageId: string,
): string | undefined {
  const collections = [
    repository.messages,
    (repository.agentKit as Record<string, unknown> | undefined)?.messages,
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const message = threadMessageRecord(entry);
      if (message?.role !== "user") continue;
      const metadata = message.metadata;
      const custom =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>).custom
          : undefined;
      if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
        continue;
      }
      const customRecord = custom as Record<string, unknown>;
      if (
        customRecord.agentKitMessageId !== messageId &&
        customRecord.agentNativeQueuedMessageId !== messageId
      ) {
        continue;
      }
      return typeof customRecord.submittedRunId === "string"
        ? customRecord.submittedRunId
        : undefined;
    }
  }
  return undefined;
}

function queuedSubmissionExpired(message: QueuedMessage, now: number): boolean {
  const custom = message.metadata?.custom;
  if (
    !custom ||
    typeof custom !== "object" ||
    Array.isArray(custom) ||
    !Object.prototype.hasOwnProperty.call(
      custom,
      AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY,
    )
  ) {
    return false;
  }
  const expiresAt = (custom as Record<string, unknown>)[
    AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY
  ];
  return (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  );
}

function queuedMessageMatchesReceipt(
  message: QueuedMessage,
  receiptMessage: QueuedMessage,
): boolean {
  const {
    promotionClaim: _messageClaim,
    delivery: _messageDelivery,
    ...messagePayload
  } = message;
  const {
    promotionClaim: _receiptClaim,
    delivery: _receiptDelivery,
    ...receiptPayload
  } = receiptMessage;
  return stableJson(messagePayload) === stableJson(receiptPayload);
}

/** Applies a queue operation to the latest durable thread state on every CAS retry. */
export async function mutateThreadQueuedMessages(
  threadId: string,
  mutation: ThreadQueuedMessageMutation,
  options: { actor?: QueuedSubmissionActor } = {},
): Promise<ThreadQueuedMessageMutationResult | null> {
  if (mutation.type === "claimFromInbox") {
    const message = mutation.receipt.message;
    if (
      mutation.receipt.state !== "queued" ||
      mutation.receipt.threadId !== threadId ||
      !message ||
      message.id !== mutation.receipt.messageId ||
      (message.threadId !== undefined && message.threadId !== threadId) ||
      typeof message.text !== "string" ||
      !message.text.trim()
    ) {
      throw new TypeError("Queued submission receipt is not claimable.");
    }
    try {
      assertNoInlineImageBytes(message, "queuedSubmissionReceipt.message");
    } catch (error) {
      throw new InlineAttachmentDataNotPersistableError(
        error instanceof Error ? error.message : undefined,
      );
    }
    parseQueueMessageInput(
      { ...message, threadId: message.threadId ?? threadId },
      "queuedSubmissionReceipt.message",
    );
  }

  if (mutation.type === "append") {
    const metadata = normalizeSubmissionDeadlineMetadata(
      mutation.message.metadata,
      Date.now(),
    );
    mutation = {
      type: "append",
      message: {
        ...mutation.message,
        threadId: mutation.message.threadId ?? threadId,
        ...(metadata ? { metadata } : {}),
      },
      ...(mutation.hashInput ? { hashInput: mutation.hashInput } : {}),
    };
    try {
      assertNoInlineImageBytes(mutation.message, "queuedMessage");
    } catch (error) {
      throw new InlineAttachmentDataNotPersistableError(
        error instanceof Error ? error.message : undefined,
      );
    }
    parseQueueMessageInput(
      {
        ...mutation.message,
        threadId: mutation.message.threadId ?? threadId,
      },
      "queuedMessage",
    );
  }

  return withThreadDataLock(threadId, async () => {
    let result: ThreadQueuedMessageMutationResult | undefined;
    let receiptUnavailable = false;
    let retryDeferred = false;
    let receiptConflict = false;
    let hadExistingQueuedMessage = false;
    let removedReceiptState: "removed" | "expired" = "removed";
    let movedToTop = false;
    let reordered = false;
    let receiptClaimMessage: QueuedMessage | undefined;
    let claimQueueSnapshot: QueuedMessage[] | undefined;
    try {
      // raw-sql-ok: updateThreadData binds the thread values in its SQL args.
      await updateThreadData(threadId, "{}", "", "", 0, {
        preserveExistingQueuedMessages: false,
        preserveCurrentMetadata: true,
        transformThreadData: (threadData) => {
          let data: unknown;
          try {
            data = JSON.parse(threadData || "{}");
          } catch {
            throw new TypeError("Agent chat thread data is not valid JSON.");
          }
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Agent chat thread data must be an object.");
          }

          const repository = data as Record<string, unknown>;
          const stored = repository.queuedMessages;
          if (stored !== undefined && !Array.isArray(stored)) {
            throw new TypeError("Agent chat queued messages must be an array.");
          }
          const current = (stored ?? []) as QueuedMessage[];
          if (
            !current.every(
              (message) =>
                message &&
                typeof message.id === "string" &&
                typeof message.text === "string",
            )
          ) {
            throw new TypeError("Agent chat queued messages are malformed.");
          }
          let queuedMessages = current;
          let response: Omit<
            ThreadQueuedMessageMutationResult,
            "queuedMessages"
          > = {};

          switch (mutation.type) {
            case "append": {
              hadExistingQueuedMessage = false;
              if (queuedSubmissionExpired(mutation.message, Date.now())) {
                response = { submissionExpired: true };
                break;
              }
              const consumedRunId = submittedQueuedMessageRunId(
                repository,
                mutation.message.id,
              );
              if (consumedRunId) {
                queuedMessages = current.filter(
                  (candidate) => candidate.id !== mutation.message.id,
                );
                response = {
                  alreadySubmitted: true,
                  submittedRunId: consumedRunId,
                  message: mutation.message,
                };
                break;
              }
              const existing = current.find(
                (message) => message.id === mutation.message.id,
              );
              hadExistingQueuedMessage = existing !== undefined;
              if (
                existing &&
                hashQueuedSubmissionPayload(threadId, existing) !==
                  hashQueuedSubmissionPayload(threadId, mutation.message)
              ) {
                if (mutation.hashInput && options.actor) {
                  queuedMessages = current;
                  response = { message: existing };
                  break;
                }
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_id_conflict",
                  mutation.message.id,
                );
              }
              if (!existing) queuedMessages = [...current, mutation.message];
              response = { message: existing ?? mutation.message };
              break;
            }
            case "remove": {
              const index = current.findIndex(
                (message) => message.id === mutation.messageId,
              );
              const message = current[index];
              const expired =
                message !== undefined &&
                queuedSubmissionExpired(message, Date.now());
              if (
                message?.promotionClaim &&
                message.promotionClaim.expiresAt > Date.now() &&
                !expired
              ) {
                response = { promotionBusy: true };
                break;
              }
              removedReceiptState = expired ? "expired" : "removed";
              queuedMessages = current.filter(
                (candidate) => candidate.id !== mutation.messageId,
              );
              break;
            }
            case "cancel": {
              const message = current.find(
                (candidate) => candidate.id === mutation.messageId,
              );
              if (
                message?.promotionClaim &&
                message.promotionClaim.expiresAt > Date.now() &&
                !queuedSubmissionExpired(message, Date.now())
              ) {
                response = { promotionBusy: true };
                break;
              }
              queuedMessages = current.filter(
                (candidate) => candidate.id !== mutation.messageId,
              );
              break;
            }
            case "moveToTop": {
              const index = current.findIndex(
                (message) => message.id === mutation.messageId,
              );
              if (index > 0) {
                const selected = current[index]!;
                if (
                  selected.promotionClaim &&
                  selected.promotionClaim.expiresAt > Date.now()
                ) {
                  response = { promotionBusy: true };
                } else {
                  movedToTop = true;
                  queuedMessages = [
                    selected,
                    ...current.filter(
                      (message) => message.id !== mutation.messageId,
                    ),
                  ];
                }
              }
              break;
            }
            case "steer": {
              const selected = current.find(
                (message) => message.id === mutation.messageId,
              );
              if (!selected) {
                throw new Error(
                  `Unknown queued message: ${mutation.messageId}`,
                );
              }
              const now = Date.now();
              if (queuedSubmissionExpired(selected, now)) {
                queuedMessages = current.filter(
                  (message) => message.id !== mutation.messageId,
                );
                response = { submissionExpired: true };
                break;
              }
              if (queuedMessageClaimActive(selected, now)) {
                response = { promotionBusy: true };
                break;
              }
              movedToTop = true;
              const steered: QueuedMessage = {
                ...selected,
                delivery: "steering",
              };
              queuedMessages = [
                steered,
                ...current.filter(
                  (message) => message.id !== mutation.messageId,
                ),
              ];
              response = { message: steered };
              break;
            }
            case "claimSteered": {
              const now = Date.now();
              const steered = current.filter(
                (message) =>
                  message.delivery !== undefined &&
                  !queuedMessageClaimActive(message, now) &&
                  !queuedSubmissionExpired(message, now),
              );
              if (steered.length === 0) {
                response = { steeredMessages: [] };
                break;
              }
              const steeredIds = new Set(steered.map(({ id }) => id));
              queuedMessages = current.filter(
                (message) => !steeredIds.has(message.id),
              );
              const delivered = steered.map(
                ({ promotionClaim: _claim, delivery: _delivery, ...message }) =>
                  message,
              );
              const records = steeredQueuedMessageRecords(
                mutation.runId,
                delivered,
                now,
              );
              response = {
                steeredMessages: delivered,
                steeredRecords: records,
              };
              result = { ...response, queuedMessages };
              return JSON.stringify(
                recordSteeredQueuedMessages(
                  { ...repository, queuedMessages },
                  records,
                ),
              );
            }
            case "deferSteered": {
              queuedMessages = current.map((message) =>
                message.delivery === "steering"
                  ? { ...message, delivery: "after_reply" as const }
                  : message,
              );
              break;
            }
            case "reorder": {
              reordered = false;
              const byId = new Map(
                current.map((message) => [message.id, message]),
              );
              const ids = mutation.messageIds;
              const ordered = ids.flatMap((id) => {
                const message = byId.get(id);
                return message ? [message] : [];
              });
              if (
                ids.length !== current.length ||
                new Set(ids).size !== ids.length ||
                ordered.length !== ids.length
              ) {
                response = { queueOrderStale: true };
                break;
              }
              const now = Date.now();
              const moving = ordered.filter(
                (message, index) => current[index]?.id !== message.id,
              );
              if (moving.length === 0) break;
              // A claimed message is already being promoted into a run, so its
              // position is no longer the queue's to change.
              if (
                moving.some((message) => queuedMessageClaimActive(message, now))
              ) {
                response = { promotionBusy: true };
                break;
              }
              reordered = true;
              queuedMessages = ordered;
              break;
            }
            case "claim": {
              const index = current.findIndex(
                (message) => message.id === mutation.messageId,
              );
              if (index < 0) {
                throw new Error(
                  `Unknown queued message: ${mutation.messageId}`,
                );
              }
              claimQueueSnapshot = current;
              const message = current[index]!;
              const now = Date.now();
              if (queuedSubmissionExpired(message, now)) {
                queuedMessages = current.filter(
                  (candidate) => candidate.id !== mutation.messageId,
                );
                response = { submissionExpired: true };
                break;
              }
              if (
                message.promotionClaim &&
                message.promotionClaim.id !== mutation.claimId &&
                message.promotionClaim.expiresAt > now
              ) {
                response = { claimBusy: true };
                break;
              }
              const claimedMessage = {
                ...message,
                promotionClaim: {
                  id: mutation.claimId,
                  expiresAt: now + QUEUED_MESSAGE_CLAIM_TTL_MS,
                },
              };
              queuedMessages = [...current];
              queuedMessages[index] = claimedMessage;
              response = { claimedMessage };
              break;
            }
            case "claimFromInbox": {
              const index = current.findIndex(
                (message) => message.id === mutation.receipt.messageId,
              );
              const existing = index >= 0 ? current[index]! : undefined;
              const receiptMessage = mutation.receipt.message!;
              const now = Date.now();
              if (queuedSubmissionExpired(receiptMessage, now)) {
                queuedMessages = current.filter(
                  (candidate) => candidate.id !== mutation.receipt.messageId,
                );
                response = { submissionExpired: true };
                break;
              }
              if (
                existing?.promotionClaim &&
                existing.promotionClaim.id !== mutation.claimId &&
                existing.promotionClaim.expiresAt > now
              ) {
                response = { claimBusy: true };
                break;
              }
              if (
                existing &&
                !queuedMessageMatchesReceipt(existing, receiptMessage)
              ) {
                response = { receiptConflict: true };
                break;
              }
              const claimedMessage = {
                ...receiptMessage,
                promotionClaim: {
                  id: mutation.claimId,
                  expiresAt: now + QUEUED_MESSAGE_CLAIM_TTL_MS,
                },
              };
              if (index < 0) {
                queuedMessages = [...current, claimedMessage];
              } else {
                queuedMessages = [...current];
                queuedMessages[index] = claimedMessage;
              }
              response = { claimedMessage };
              break;
            }
            case "retryReceipt":
            case "blockReceipt": {
              receiptClaimMessage = current.find(
                (message) => message.id === mutation.messageId,
              );
              if (
                !receiptMutationOwnsPromotionClaim(
                  receiptClaimMessage,
                  mutation.claimId,
                  Date.now(),
                )
              ) {
                response = { claimBusy: true };
              }
              break;
            }
            case "recordInterruptRun":
            case "clearInterruptRun": {
              receiptClaimMessage = current.find(
                (message) => message.id === mutation.messageId,
              );
              if (
                !receiptMutationOwnsPromotionClaim(
                  receiptClaimMessage,
                  mutation.claimId,
                  Date.now(),
                )
              ) {
                response = { claimBusy: true };
              }
              break;
            }
            case "renewClaim": {
              const index = current.findIndex(
                (message) => message.id === mutation.messageId,
              );
              const message = index >= 0 ? current[index] : undefined;
              const now = Date.now();
              if (
                !message ||
                queuedSubmissionExpired(message, now) ||
                (mutation.renewUntil !== undefined &&
                  now >= mutation.renewUntil) ||
                !receiptMutationOwnsPromotionClaim(
                  message,
                  mutation.claimId,
                  now,
                )
              ) {
                response = { claimLost: true };
                break;
              }
              const claimedMessage = {
                ...message,
                promotionClaim: {
                  id: mutation.claimId,
                  expiresAt: now + QUEUED_MESSAGE_CLAIM_TTL_MS,
                },
              };
              queuedMessages = [...current];
              queuedMessages[index] = claimedMessage;
              response = { claimedMessage };
              break;
            }
            case "release": {
              const index = current.findIndex(
                (message) => message.id === mutation.messageId,
              );
              const message = current[index];
              if (message?.promotionClaim?.id === mutation.claimId) {
                const { promotionClaim: _claim, ...releasedMessage } = message;
                queuedMessages = [...current];
                queuedMessages[index] = releasedMessage;
                response = { released: true };
              } else {
                response = { released: false };
              }
              break;
            }
          }

          result = { ...response, queuedMessages };
          return JSON.stringify({ ...repository, queuedMessages });
        },
        beforeUpdate:
          mutation.type === "append" && options.actor
            ? async (tx) => {
                await lockThreadRunSlot(tx, threadId);
                return true;
              }
            : mutation.type === "claimSteered"
              ? async (tx) => {
                  for (const message of result?.steeredMessages ?? []) {
                    const receipt = await readQueuedSubmissionReceipt(
                      tx,
                      threadId,
                      message.id,
                      { forUpdate: true },
                    );
                    // Another delivery already owns it; this run must not
                    // send it a second time.
                    if (receipt && receipt.state !== "queued") {
                      if (result) {
                        result.steeredMessages = [];
                        result.steeredRecords = [];
                      }
                      return false;
                    }
                  }
                  return true;
                }
              : mutation.type === "claimFromInbox"
                ? async (tx) => {
                    const currentReceipt = await readQueuedSubmissionReceipt(
                      tx,
                      threadId,
                      mutation.receipt.messageId,
                      { forUpdate: true },
                    );
                    if (
                      !currentReceipt ||
                      !queuedSubmissionReceiptSnapshotMatches(
                        currentReceipt,
                        mutation.receipt,
                      )
                    ) {
                      receiptUnavailable = true;
                      return false;
                    }
                    if (
                      currentReceipt.retryAfter !== undefined &&
                      currentReceipt.retryAfter > Date.now()
                    ) {
                      retryDeferred = true;
                      return false;
                    }
                    return true;
                  }
                : mutation.type === "claim"
                  ? async (tx) => {
                      if (result?.submissionExpired) return true;
                      const receipt = await readQueuedSubmissionReceipt(
                        tx,
                        threadId,
                        mutation.messageId,
                        { forUpdate: true },
                      );
                      if (!receipt) return true;
                      result = {
                        ...(result ?? { queuedMessages: [] }),
                        queuedMessages:
                          claimQueueSnapshot ?? result?.queuedMessages ?? [],
                        claimedMessage: undefined,
                        claimBusy: undefined,
                        receiptManaged: true,
                      };
                      return false;
                    }
                  : mutation.type === "renewClaim"
                    ? async (tx) => {
                        const receipt = await readQueuedSubmissionReceipt(
                          tx,
                          threadId,
                          mutation.messageId,
                        );
                        if (
                          result?.claimLost === true ||
                          receipt?.state !== "queued" ||
                          (mutation.renewUntil !== undefined &&
                            Date.now() >= mutation.renewUntil) ||
                          (mutation.runId !== undefined &&
                            receipt.interruptRunId !== mutation.runId)
                        ) {
                          if (result) {
                            result.claimLost = true;
                            result.claimedMessage = undefined;
                          }
                          return false;
                        }
                        return true;
                      }
                    : mutation.type === "recordInterruptRun" ||
                        mutation.type === "clearInterruptRun"
                      ? async (tx) => {
                          const ownsClaim = receiptMutationOwnsPromotionClaim(
                            receiptClaimMessage,
                            mutation.claimId,
                            Date.now(),
                          );
                          if (!ownsClaim) {
                            if (result) result.claimBusy = true;
                            return false;
                          }
                          const receipt = await readQueuedSubmissionReceipt(
                            tx,
                            threadId,
                            mutation.messageId,
                          );
                          return (
                            receipt?.state === "queued" &&
                            (!receipt.interruptRunId ||
                              receipt.interruptRunId === mutation.runId)
                          );
                        }
                      : mutation.type === "retryReceipt" ||
                          mutation.type === "blockReceipt"
                        ? async () => {
                            const ownsClaim = receiptMutationOwnsPromotionClaim(
                              receiptClaimMessage,
                              mutation.claimId,
                              Date.now(),
                            );
                            if (!ownsClaim && result) result.claimBusy = true;
                            return ownsClaim;
                          }
                        : undefined,
        afterUpdate: async (tx) => {
          if (!result) return;
          if (mutation.type === "claimSteered") {
            for (const message of result.steeredMessages ?? []) {
              const receipt = await readQueuedSubmissionReceipt(
                tx,
                threadId,
                message.id,
                { forUpdate: true },
              );
              if (!receipt) continue;
              const submitted = await tx.execute({
                sql: `UPDATE agent_chat_submission_inbox SET state = 'submitted', submitted_run_id = ?, interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
                args: [mutation.runId, Date.now(), threadId, message.id],
              });
              if (submitted.rowsAffected !== 1) {
                throw new Error(
                  `Queued submission ${message.id} changed while a run claimed it.`,
                );
              }
            }
            return;
          }
          if (mutation.type === "steer" && result.submissionExpired) {
            await tx.execute({
              sql: `UPDATE agent_chat_submission_inbox SET state = 'expired', interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
              args: [Date.now(), threadId, mutation.messageId],
            });
            return;
          }
          if (
            mutation.type === "recordInterruptRun" ||
            mutation.type === "clearInterruptRun"
          ) {
            const receipt = await readQueuedSubmissionReceipt(
              tx,
              threadId,
              mutation.messageId,
              { forUpdate: true },
            );
            if (!receipt || receipt.state !== "queued") {
              result.receiptUpdated = false;
              return;
            }
            if (mutation.type === "recordInterruptRun") {
              if (
                receipt.interruptRunId &&
                receipt.interruptRunId !== mutation.runId
              ) {
                result.receiptUpdated = false;
                return;
              }
              const updated = await tx.execute({
                sql: `UPDATE agent_chat_submission_inbox
                      SET interrupt_run_id = ?, updated_at = ?
                      WHERE thread_id = ? AND message_id = ? AND state = 'queued'
                        AND (interrupt_run_id IS NULL OR interrupt_run_id = ?)`,
                args: [
                  mutation.runId,
                  Date.now(),
                  threadId,
                  mutation.messageId,
                  mutation.runId,
                ],
              });
              result.receiptUpdated = updated.rowsAffected === 1;
              return;
            }
            if (!receipt.interruptRunId) {
              result.receiptUpdated = true;
              return;
            }
            if (receipt.interruptRunId !== mutation.runId) {
              result.receiptUpdated = false;
              return;
            }
            const updated = await tx.execute({
              sql: `UPDATE agent_chat_submission_inbox
                    SET interrupt_run_id = NULL, updated_at = ?
                    WHERE thread_id = ? AND message_id = ? AND state = 'queued'
                      AND interrupt_run_id = ?`,
              args: [Date.now(), threadId, mutation.messageId, mutation.runId],
            });
            result.receiptUpdated = updated.rowsAffected === 1;
          } else if (mutation.type === "cancel" && !result.promotionBusy) {
            const receipt = await readQueuedSubmissionReceipt(
              tx,
              threadId,
              mutation.messageId,
              { forUpdate: true },
            );
            if (receipt?.state === "submitted") {
              if (!receipt.submittedRunId) {
                throw new TypeError(
                  "Stored submitted receipt has no submitted run identifier.",
                );
              }
              result.submittedRunId = receipt.submittedRunId;
              return;
            }
            if (receipt?.state !== "queued") return;
            const removed = await tx.execute({
              sql: `UPDATE agent_chat_submission_inbox
                    SET state = 'removed', interrupt_run_id = NULL,
                        retry_after = NULL, updated_at = ?
                    WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
              args: [Date.now(), threadId, mutation.messageId],
            });
            if (removed.rowsAffected !== 1) {
              throw new Error(
                `Queued submission ${mutation.messageId} changed while cancellation held its receipt lock.`,
              );
            }
            result.receiptUpdated = true;
          } else if (
            mutation.type === "retryReceipt" ||
            mutation.type === "blockReceipt"
          ) {
            if (
              !receiptMutationOwnsPromotionClaim(
                receiptClaimMessage,
                mutation.claimId,
                Date.now(),
              )
            ) {
              result.claimBusy = true;
              return;
            }
            const updated =
              mutation.type === "retryReceipt"
                ? await tx.execute({
                    sql: `UPDATE agent_chat_submission_inbox SET retry_after = ?${mutation.countRetry ? ", retry_count = retry_count + 1" : ""}, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
                    args: [
                      mutation.retryAfter,
                      Date.now(),
                      threadId,
                      mutation.messageId,
                    ],
                  })
                : await tx.execute({
                    sql: `UPDATE agent_chat_submission_inbox SET state = 'blocked', interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
                    args: [Date.now(), threadId, mutation.messageId],
                  });
            result.receiptUpdated = updated.rowsAffected === 1;
          } else if (mutation.type === "append") {
            const { message } = mutation;
            if (result.alreadySubmitted) {
              const existing = await readQueuedSubmissionReceipt(
                tx,
                threadId,
                message.id,
              );
              const actor = options.actor
                ? normalizeQueuedSubmissionActor(options.actor)
                : undefined;
              const hashInput = mutation.hashInput ?? message;
              const hash = hashQueuedSubmissionPayload(threadId, hashInput);
              if (
                existing &&
                (existing.payloadHash !== hash ||
                  (actor &&
                    !queuedSubmissionActorMatches(existing.actor, actor)))
              ) {
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_id_conflict",
                  message.id,
                );
              }
              if (existing?.state === "queued") {
                await markQueuedSubmissionSubmitted(tx, {
                  threadId,
                  messageId: message.id,
                  runId: result.submittedRunId,
                  actor: existing.actor,
                });
              }
              return;
            }
            if (result.submissionExpired || !options.actor) return;
            const actor = normalizeQueuedSubmissionActor(options.actor);
            const payloadMessage = result.message ?? message;
            const hashInput = mutation.hashInput ?? payloadMessage;
            const hash = hashQueuedSubmissionPayload(threadId, hashInput);
            const existing = await readQueuedSubmissionReceipt(
              tx,
              threadId,
              message.id,
            );
            if (hadExistingQueuedMessage && !existing) {
              throw new QueuedSubmissionAdmissionError(
                "queued_message_id_conflict",
                message.id,
              );
            }
            if (existing) {
              if (
                existing.payloadHash !== hash ||
                !queuedSubmissionActorMatches(existing.actor, actor)
              ) {
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_id_conflict",
                  message.id,
                );
              }
              if (existing.state === "submitted") {
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_already_submitted",
                  message.id,
                  existing.submittedRunId,
                );
              }
              if (existing.state !== "queued") {
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_id_terminal",
                  message.id,
                );
              }
              return;
            }
            const now = Date.now();
            await tx.execute({
              sql: `INSERT INTO agent_chat_submission_inbox
                (thread_id, message_id, state, actor_email, actor_auth_user_id, actor_identity_authenticated_at_ms, actor_name, actor_org_id, actor_org_scope, actor_anonymous, payload_hash, payload_json, interrupt_active_run, created_at, updated_at)
                VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                threadId,
                message.id,
                actor.email,
                actor.authUserId ?? null,
                actor.identityAuthenticatedAtMs ?? null,
                actor.name ?? null,
                actor.orgId ?? null,
                actor.orgScope ?? null,
                actor.anonymous === true,
                hash,
                JSON.stringify(stripInlineBytes(payloadMessage, "placeholder")),
                payloadMessage.interruptActiveRun === true,
                now,
                now,
              ],
            });
            return;
          }
          if (mutation.type === "remove" && !result.promotionBusy) {
            await tx.execute({
              sql: `UPDATE agent_chat_submission_inbox SET state = ?, interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
              args: [
                removedReceiptState,
                Date.now(),
                threadId,
                mutation.messageId,
              ],
            });
          } else if (mutation.type === "claim" && result.submissionExpired) {
            await tx.execute({
              sql: `UPDATE agent_chat_submission_inbox SET state = 'expired', interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
              args: [Date.now(), threadId, mutation.messageId],
            });
          } else if (mutation.type === "claimFromInbox") {
            const currentReceipt = await readQueuedSubmissionReceipt(
              tx,
              threadId,
              mutation.receipt.messageId,
              { forUpdate: true },
            );
            assertQueuedSubmissionReceiptSnapshotMatches(
              currentReceipt,
              mutation.receipt,
            );
            if (result.receiptConflict) {
              const blocked = await tx.execute({
                sql: `UPDATE agent_chat_submission_inbox SET state = 'blocked', interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
                args: [Date.now(), threadId, mutation.receipt.messageId],
              });
              if (blocked.rowsAffected !== 1) {
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_id_terminal",
                  mutation.receipt.messageId,
                );
              }
              receiptConflict = true;
            } else if (result.submissionExpired) {
              const expired = await tx.execute({
                sql: `UPDATE agent_chat_submission_inbox SET state = 'expired', interrupt_run_id = NULL, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
                args: [Date.now(), threadId, mutation.receipt.messageId],
              });
              if (expired.rowsAffected !== 1) {
                throw new QueuedSubmissionAdmissionError(
                  "queued_message_id_terminal",
                  mutation.receipt.messageId,
                );
              }
            }
          } else if (
            (mutation.type === "moveToTop" || mutation.type === "steer") &&
            movedToTop
          ) {
            await tx.execute({
              sql: `UPDATE agent_chat_submission_inbox SET move_to_top_at = ?, retry_after = NULL, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
              args: [Date.now(), Date.now(), threadId, mutation.messageId],
            });
          } else if (mutation.type === "reorder" && reordered) {
            // Promotion reads move_to_top_at DESC, so descending stamps from
            // now encode the whole order; a later move-to-top still wins.
            const now = Date.now();
            for (const [index, messageId] of mutation.messageIds.entries()) {
              await tx.execute({
                sql: `UPDATE agent_chat_submission_inbox SET move_to_top_at = ?, updated_at = ? WHERE thread_id = ? AND message_id = ? AND state = 'queued'`,
                args: [now - index, now, threadId, messageId],
              });
            }
          }
        },
      });
      if (receiptUnavailable) {
        result = { queuedMessages: [], receiptUnavailable: true };
      } else if (retryDeferred) {
        result = { queuedMessages: [], retryDeferred: true };
      } else if (receiptConflict) {
        result = { queuedMessages: [], receiptConflict: true };
      }
    } catch (error) {
      if (
        error instanceof QueuedSubmissionAdmissionError &&
        error.code === "queued_message_already_submitted" &&
        mutation.type === "append"
      ) {
        const thread = await getThread(threadId);
        let queuedMessages: QueuedMessage[] = [];
        try {
          const repository = JSON.parse(thread?.threadData ?? "{}") as Record<
            string,
            unknown
          >;
          queuedMessages = Array.isArray(repository.queuedMessages)
            ? (repository.queuedMessages as QueuedMessage[])
            : [];
        } catch {
          queuedMessages = [];
        }
        return {
          queuedMessages,
          message:
            (await getQueuedSubmissionReceipt(threadId, mutation.message.id))
              ?.message ?? mutation.message,
          alreadySubmitted: true,
          ...(error.submittedRunId
            ? { submittedRunId: error.submittedRunId }
            : {}),
        };
      }
      throw error;
    }
    return result ?? null;
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
    // Mirror the hash into the indexed column so getThreadByShareToken
    // resolves via an equality lookup instead of a LIKE scan over every
    // thread's blob. thread_data stays the source of truth for validation.
    await setThreadShareTokenHashColumn(threadId, thread.ownerEmail, tokenHash);

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
  ownerEmail: string,
  tokenHash: string | null,
): Promise<void> {
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE chat_threads SET share_token_hash = ? WHERE id = ? AND LOWER(owner_email) = LOWER(?)`,
    args: [tokenHash, threadId, ownerEmail],
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
    await setThreadShareTokenHashColumn(threadId, thread.ownerEmail, null);

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
    // thread_data remains the source of truth: verify the stored share
    // matches and is not revoked even when the indexed column matched.
    const stored = readStoredThreadShare(thread.threadData);
    if (!stored?.tokenHash || stored.revokedAt) return null;
    if (stored.tokenHash !== tokenHash) return null;
    return thread;
  };

  // Fast path: indexed equality lookup on the mirrored hash column.
  // guard:allow-unscoped — public bearer-token lookup; stored hash and revocation state are validated before returning the thread
  const indexed = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE share_token_hash = ? LIMIT 10`,
    args: [tokenHash],
  });
  for (const row of indexed.rows) {
    const thread = validate(row);
    if (thread) return thread;
  }

  // Legacy fallback: shares created before the share_token_hash column
  // existed only carry the hash inside the thread_data blob. Backfill the
  // column on hit so the next lookup takes the indexed path.
  // guard:allow-unscoped — public bearer-token lookup; each candidate is validated against stored hash and revocation state
  const legacy = await client.execute({
    sql: `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE share_token_hash IS NULL AND thread_data LIKE ? LIMIT 10`,
    args: [`%${tokenHash}%`],
  });
  for (const row of legacy.rows) {
    const thread = validate(row);
    if (thread) {
      await setThreadShareTokenHashColumn(
        thread.id,
        thread.ownerEmail,
        tokenHash,
      ).catch(() => {});
      return thread;
    }
  }
  return null;
}

/**
 * Grant a user an explicit share on a thread they don't own. Used by the
 * messaging-integration path, where a channel conversation runs as the
 * integration service principal and so creates a thread owned by
 * `integration@<platform>` rather than the human who asked — without this the
 * "Open thread" deep link resolves to a 404 for them.
 *
 * Idempotent, and never downgrades an existing stronger role.
 */
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

export async function deleteThread(
  id: string,
  ownerEmail: string,
  options: { orgId?: string | null; collapseEdits?: boolean } = {},
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  let ids = [id];
  const source = options.collapseEdits
    ? await getOwnedThread(id, ownerEmail)
    : null;
  if (options.collapseEdits && !source) return false;
  if (!client.transaction) {
    throw new Error("Atomic chat thread deletion requires transaction support");
  }
  const count = await client.transaction(async (tx) => {
    if (source) {
      if (!(await lockEditRoot(tx, source, ownerEmail))) return 0;
      const members = await tx.execute({
        sql: `SELECT sibling.id FROM chat_threads source JOIN chat_threads sibling ON LOWER(sibling.owner_email) = LOWER(source.owner_email) AND sibling.org_id IS NOT DISTINCT FROM source.org_id AND sibling.source_app_id IS NOT DISTINCT FROM source.source_app_id AND sibling.scope_type IS NOT DISTINCT FROM source.scope_type AND sibling.scope_id IS NOT DISTINCT FROM source.scope_id AND COALESCE(sibling.edit_root_id, sibling.id) = COALESCE(source.edit_root_id, source.id) WHERE source.id = ? AND LOWER(source.owner_email) = LOWER(?) AND source.org_id IS NOT DISTINCT FROM ? AND source.source_app_id IS NOT DISTINCT FROM ? AND source.scope_type IS NOT DISTINCT FROM ? AND source.scope_id IS NOT DISTINCT FROM ? AND COALESCE(source.edit_root_id, source.id) = ?`,
        args: [
          id,
          ownerEmail,
          source.orgId,
          source.source?.appId ?? null,
          source.scope?.type ?? null,
          source.scope?.id ?? null,
          source.editRootId ?? source.id,
        ],
      });
      ids = members.rows.map((row) => String(row.id));
      if (!ids.length) return 0;
    }
    let deletedCount = 0;
    for (const relatedId of ids) {
      const deleted = await tx.execute({
        sql: `DELETE FROM chat_threads WHERE id = ? AND LOWER(owner_email) = LOWER(?)`,
        args: [relatedId, ownerEmail],
      });
      if (deleted.rowsAffected === 0) {
        if (options.collapseEdits)
          throw new Error("Chat thread lineage changed during deletion");
        continue;
      }
      await tx.execute({
        sql: `DELETE FROM agent_chat_submission_inbox WHERE thread_id = ?`,
        args: [relatedId],
      });
      await tx.execute({
        sql: `DELETE FROM chat_thread_shares WHERE resource_id = ?`,
        args: [relatedId],
      });
      deletedCount++;
    }
    return deletedCount;
  });
  if (count > 0) {
    for (const relatedId of ids) emitChatThreadChange(relatedId);
    return true;
  }
  return false;
}
