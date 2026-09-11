import type { InboxThreadItem } from "@shared/inbox-threads.js";
import type { EmailMessage, Label } from "@shared/types.js";
/**
 * Data access for the synced inbox store (`mail_inbox_threads` +
 * `mail_sync_accounts`). `inbox-sync.ts` is the only writer of thread rows
 * and sync-account progress; this file is where all of that SQL lives so
 * neither the sync engine nor callers hand-roll queries against the tables.
 *
 * The first five exports below (`InboxThreadRow`, `SyncAccountRow`,
 * `readInboxThreads`, `readSyncAccounts`, `readCachedLabels`,
 * `applyLocalLabelDelta`, `inboxRowToItem`) are the contracted surface for
 * the `list-inbox-threads` action. Everything else here is sync-engine
 * plumbing.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type CachedGmailLabel = {
  id: string;
  name: string;
  type?: string;
  color?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
};

export type InboxThreadRow = {
  id: string;
  ownerEmail: string;
  accountEmail: string;
  threadId: string;
  historyId: string | null;
  inInbox: boolean;
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  isAutomated: boolean;
  latestDate: number;
  latestMessageId: string | null;
  subject: string | null;
  snippet: string | null;
  fromName: string | null;
  fromEmail: string | null;
  to: Array<{ name: string; email: string }>;
  labelIds: string[];
  messageIds: string[];
  messageCount: number | null;
  unreadCount: number | null;
  hasAttachments: boolean;
  syncedAt: number;
  updatedAt: number;
};

export type SyncAccountRow = {
  id: string;
  ownerEmail: string;
  accountEmail: string;
  historyId: string | null;
  fullSyncPageToken: string | null;
  fullSyncHistoryId: string | null;
  fullSyncStartedAt: number | null;
  status: "idle" | "syncing" | "error" | "needs_reauth";
  lastError: string | null;
  lastSyncedAt: number | null;
  syncClaimId: string | null;
  syncClaimedAt: number | null;
  labels: CachedGmailLabel[] | null;
  labelsUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

function rowId(ownerEmail: string, accountEmail: string): string {
  return `${ownerEmail.toLowerCase()}:${accountEmail.toLowerCase()}`;
}

function threadRowId(
  ownerEmail: string,
  accountEmail: string,
  threadId: string,
): string {
  return `${ownerEmail.toLowerCase()}:${accountEmail.toLowerCase()}:${threadId}`;
}

function parseJsonArray<T>(raw: string | null, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function toInboxThreadRow(
  row: typeof schema.mailInboxThreads.$inferSelect,
): InboxThreadRow {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    accountEmail: row.accountEmail,
    threadId: row.threadId,
    historyId: row.historyId,
    inInbox: row.inInbox === 1,
    isUnread: row.isUnread === 1,
    isStarred: row.isStarred === 1,
    isImportant: row.isImportant === 1,
    isAutomated: row.isAutomated === 1,
    latestDate: row.latestDate,
    latestMessageId: row.latestMessageId,
    subject: row.subject,
    snippet: row.snippet,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    to: parseJsonArray<{ name: string; email: string }>(row.toJson, []),
    labelIds: parseJsonArray<string>(row.labelIdsJson, []),
    messageIds: parseJsonArray<string>(row.messageIdsJson, []),
    messageCount: row.messageCount,
    unreadCount: row.unreadCount,
    hasAttachments: row.hasAttachments === 1,
    syncedAt: row.syncedAt,
    updatedAt: row.updatedAt,
  };
}

function toSyncAccountRow(
  row: typeof schema.mailSyncAccounts.$inferSelect,
): SyncAccountRow {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    accountEmail: row.accountEmail,
    historyId: row.historyId,
    fullSyncPageToken: row.fullSyncPageToken,
    fullSyncHistoryId: row.fullSyncHistoryId,
    fullSyncStartedAt: row.fullSyncStartedAt,
    status: row.status as SyncAccountRow["status"],
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    syncClaimId: row.syncClaimId,
    syncClaimedAt: row.syncClaimedAt,
    labels: row.labelsJson
      ? parseJsonArray<CachedGmailLabel>(row.labelsJson, [])
      : null,
    labelsUpdatedAt: row.labelsUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readInboxThreads(
  ownerEmail: string,
  opts?: { accountEmails?: string[] },
): Promise<InboxThreadRow[]> {
  const conditions = [
    eq(schema.mailInboxThreads.ownerEmail, ownerEmail.toLowerCase()),
    eq(schema.mailInboxThreads.inInbox, 1),
  ];
  if (opts?.accountEmails?.length) {
    conditions.push(
      inArray(
        schema.mailInboxThreads.accountEmail,
        opts.accountEmails.map((e) => e.toLowerCase()),
      ),
    );
  }
  const rows = await getDb()
    .select()
    .from(schema.mailInboxThreads)
    .where(and(...conditions))
    .orderBy(desc(schema.mailInboxThreads.latestDate));
  return rows.map(toInboxThreadRow);
}

export async function readSyncAccounts(
  ownerEmail: string,
): Promise<SyncAccountRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.mailSyncAccounts)
    .where(eq(schema.mailSyncAccounts.ownerEmail, ownerEmail.toLowerCase()));
  return rows.map(toSyncAccountRow);
}

// Mirrors actions/list-labels.ts's Gmail label normalization exactly (same
// ids/names/system-vs-user split) so a label id computed from the live path
// and one computed from the cache never disagree.
const SYSTEM_LABELS: Record<string, { id: string; name: string }> = {
  INBOX: { id: "inbox", name: "Inbox" },
  STARRED: { id: "starred", name: "Starred" },
  SENT: { id: "sent", name: "Sent" },
  DRAFT: { id: "drafts", name: "Drafts" },
  TRASH: { id: "trash", name: "Trash" },
  IMPORTANT: { id: "important", name: "Important" },
  CATEGORY_PERSONAL: { id: "personal", name: "Primary" },
  CATEGORY_SOCIAL: { id: "social", name: "Social" },
  CATEGORY_UPDATES: { id: "updates", name: "Updates" },
  CATEGORY_PROMOTIONS: { id: "promotions", name: "Promotions" },
  CATEGORY_FORUMS: { id: "forums", name: "Forums" },
};

const CATEGORY_NAMES: Record<string, string> = {
  important: "Important",
  "note-to-self": "Note to Self",
  promotions: "Promotions",
  social: "Social",
  updates: "Updates",
  forums: "Forums",
};

export async function readCachedLabels(
  ownerEmail: string,
  accountEmails?: string[],
): Promise<{
  labels: Label[];
  labelMapByAccount: Map<string, Map<string, string>>;
}> {
  const accounts = await readSyncAccounts(ownerEmail);
  const requested = accountEmails?.length
    ? new Set(accountEmails.map((e) => e.toLowerCase()))
    : null;

  const labelsById = new Map<string, Label>();
  const labelMapByAccount = new Map<string, Map<string, string>>();

  for (const account of accounts) {
    if (requested && !requested.has(account.accountEmail)) continue;
    const rawLabelMap = new Map<string, string>();
    labelMapByAccount.set(account.accountEmail, rawLabelMap);
    for (const label of account.labels ?? []) {
      if (!label.id || !label.name) continue;
      rawLabelMap.set(label.id, label.name);
      const systemLabel = SYSTEM_LABELS[label.id];
      const id = systemLabel?.id ?? label.name.toLowerCase().replace(/_/g, " ");
      const current = labelsById.get(id);
      const next: Label = {
        id,
        name: systemLabel?.name ?? label.name.replace(/_/g, " "),
        type: label.id.startsWith("Label_") ? "user" : "system",
        unreadCount:
          Number(label.threadsUnread ?? label.messagesUnread ?? 0) || 0,
        totalCount: Number(label.threadsTotal ?? label.messagesTotal ?? 0) || 0,
      };
      labelsById.set(
        id,
        current
          ? {
              ...current,
              unreadCount: (current.unreadCount ?? 0) + (next.unreadCount ?? 0),
              totalCount: (current.totalCount ?? 0) + (next.totalCount ?? 0),
            }
          : next,
      );
    }
  }

  // Never throw on a missing cache — an account that hasn't synced labels
  // yet (or isn't in `accounts` at all) just contributes an empty map.
  for (const email of requested ?? []) {
    if (!labelMapByAccount.has(email)) labelMapByAccount.set(email, new Map());
  }

  for (const [id, name] of Object.entries(CATEGORY_NAMES)) {
    const label = labelsById.get(id);
    if (label) label.name = name;
    else
      labelsById.set(id, {
        id,
        name,
        type: "system",
        unreadCount: 0,
        totalCount: 0,
      });
  }

  return { labels: [...labelsById.values()], labelMapByAccount };
}

// ---------------------------------------------------------------------------
// Optimistic local mutation
// ---------------------------------------------------------------------------

export type LocalLabelDelta = {
  add?: string[];
  remove?: string[];
  /**
   * "thread" (default): the mutation applies to every message in the thread
   * (archive, trash, mark-thread-read), so UNREAD/STARRED are derived from
   * whether the unioned label set contains them, as before.
   * "message": the mutation only touched `messageIds` (mark-read/star by
   * message id) — UNREAD/STARRED must be derived from that subset instead,
   * see below.
   */
  scope?: "thread" | "message";
  /** Message ids the delta actually targets; only meaningful for scope "message". */
  messageIds?: string[];
};

export async function applyLocalLabelDelta(
  ownerEmail: string,
  accountEmail: string,
  threadIds: string[],
  delta: LocalLabelDelta,
): Promise<void> {
  if (threadIds.length === 0) return;
  const ids = threadIds.map((t) => threadRowId(ownerEmail, accountEmail, t));
  const rows = await getDb()
    .select({
      id: schema.mailInboxThreads.id,
      labelIdsJson: schema.mailInboxThreads.labelIdsJson,
      messageIdsJson: schema.mailInboxThreads.messageIdsJson,
      unreadCount: schema.mailInboxThreads.unreadCount,
    })
    .from(schema.mailInboxThreads)
    .where(inArray(schema.mailInboxThreads.id, ids));
  if (rows.length === 0) return;

  const add = delta.add ?? [];
  const remove = new Set(delta.remove ?? []);
  const now = Date.now();
  const messageScoped = delta.scope === "message";
  const targetMessageIds = new Set(delta.messageIds ?? []);

  await Promise.all(
    rows.map((row) => {
      const labels = new Set(parseJsonArray<string>(row.labelIdsJson, []));
      for (const l of remove) labels.delete(l);
      for (const l of add) labels.add(l);

      const set: Record<string, unknown> = {
        labelIdsJson: JSON.stringify([...labels]),
        inInbox: labels.has("INBOX") && !labels.has("TRASH") ? 1 : 0,
        isImportant: labels.has("IMPORTANT") ? 1 : 0,
        updatedAt: now,
      };

      if (!messageScoped) {
        set.isUnread = labels.has("UNREAD") ? 1 : 0;
        set.isStarred = labels.has("STARRED") ? 1 : 0;
      } else {
        // Only the targeted messages changed, so isUnread/unreadCount must
        // come from that subset — not from whether UNREAD is anywhere in the
        // thread's unioned label set, which reflects just the last-touched
        // message.
        const matched = parseJsonArray<string>(row.messageIdsJson, []).filter(
          (id) => targetMessageIds.has(id),
        ).length;
        const currentUnread = row.unreadCount ?? 0;
        if (delta.remove?.includes("UNREAD")) {
          const nextUnread = Math.max(0, currentUnread - matched);
          set.unreadCount = nextUnread;
          set.isUnread = nextUnread > 0 ? 1 : 0;
        } else if (delta.add?.includes("UNREAD")) {
          set.unreadCount = currentUnread + matched;
          set.isUnread = 1;
        }
        if (delta.add?.includes("STARRED")) {
          set.isStarred = 1;
        }
        // Removing STARRED at message scope is intentionally a no-op for
        // isStarred: we don't track which individual message(s) hold the
        // star, so we can't tell whether another message in the thread is
        // still starred. The next history sync (within the 15s freshness
        // window) refetches the thread from Gmail and corrects it.
      }

      return getDb()
        .update(schema.mailInboxThreads)
        .set(set)
        .where(eq(schema.mailInboxThreads.id, row.id));
    }),
  );
}

/**
 * Resolves Gmail message ids to their thread id via the store's
 * `messageIdsJson`, for callers (message-level mutations) that only have
 * message ids but need a threadId to patch a thread row. Ids the store
 * hasn't synced yet are simply absent from the result — best-effort, same as
 * {@link applyLocalLabelDelta}.
 */
export async function findThreadIdsByMessageIds(
  ownerEmail: string,
  accountEmail: string,
  messageIds: readonly string[],
): Promise<Map<string, string>> {
  const wanted = new Set(messageIds);
  const result = new Map<string, string>();
  if (wanted.size === 0) return result;

  const rows = await getDb()
    .select({
      threadId: schema.mailInboxThreads.threadId,
      messageIdsJson: schema.mailInboxThreads.messageIdsJson,
    })
    .from(schema.mailInboxThreads)
    .where(
      and(
        eq(schema.mailInboxThreads.ownerEmail, ownerEmail.toLowerCase()),
        eq(schema.mailInboxThreads.accountEmail, accountEmail.toLowerCase()),
      ),
    );
  for (const row of rows) {
    for (const id of parseJsonArray<string>(row.messageIdsJson, [])) {
      if (wanted.has(id)) result.set(id, row.threadId);
    }
  }
  return result;
}

/**
 * Resolves which connected account owns a thread, for callers (message/thread
 * mutations) that need an accountEmail to fetch a token but only have a
 * threadId. Best-effort like {@link findThreadIdsByMessageIds}: returns null
 * when the store hasn't synced the thread yet, never throws.
 */
export async function findAccountForThread(
  ownerEmail: string,
  threadId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ accountEmail: schema.mailInboxThreads.accountEmail })
    .from(schema.mailInboxThreads)
    .where(
      and(
        eq(schema.mailInboxThreads.ownerEmail, ownerEmail.toLowerCase()),
        eq(schema.mailInboxThreads.threadId, threadId),
      ),
    )
    .limit(1);
  return rows[0]?.accountEmail ?? null;
}

/**
 * Same as {@link findAccountForThread} but resolves from a message id via
 * `messageIdsJson`, same scan approach as {@link findThreadIdsByMessageIds}.
 */
export async function findAccountForMessage(
  ownerEmail: string,
  messageId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({
      accountEmail: schema.mailInboxThreads.accountEmail,
      messageIdsJson: schema.mailInboxThreads.messageIdsJson,
    })
    .from(schema.mailInboxThreads)
    .where(eq(schema.mailInboxThreads.ownerEmail, ownerEmail.toLowerCase()));
  for (const row of rows) {
    if (parseJsonArray<string>(row.messageIdsJson, []).includes(messageId)) {
      return row.accountEmail;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row -> API shape
// ---------------------------------------------------------------------------

// Same category-label remap as gmailToEmailMessage in google-auth.ts.
const CATEGORY_MAP: Record<string, string> = {
  IMPORTANT: "important",
  CATEGORY_PERSONAL: "personal",
  CATEGORY_SOCIAL: "social",
  CATEGORY_UPDATES: "updates",
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_FORUMS: "forums",
};

export function inboxRowToItem(
  row: InboxThreadRow,
  labelMap: Map<string, string> | undefined,
): InboxThreadItem {
  const labelIds = row.labelIds
    .filter((l) => l !== "UNREAD" && l !== "STARRED")
    .map((l) => {
      if (CATEGORY_MAP[l]) return CATEGORY_MAP[l];
      const name = labelMap?.get(l) || l;
      return name.replace(/_/g, " ").toLowerCase();
    });

  const item: EmailMessage = {
    id: row.latestMessageId || row.threadId,
    threadId: row.threadId,
    from: { name: row.fromName ?? "", email: row.fromEmail ?? "" },
    to: row.to,
    subject: row.subject ?? "",
    snippet: row.snippet ?? "",
    body: "",
    bodyHtml: undefined,
    date: new Date(row.latestDate).toISOString(),
    isRead: !row.isUnread,
    isStarred: row.isStarred,
    isArchived: !row.inInbox,
    isTrashed: row.labelIds.includes("TRASH"),
    labelIds,
    accountEmail: row.accountEmail,
  };

  return {
    ...item,
    messageCount: row.messageCount ?? row.messageIds.length,
    unreadCount: row.unreadCount ?? 0,
    messageIds: row.messageIds,
    isAutomated: row.isAutomated,
  };
}

// ---------------------------------------------------------------------------
// Sync-engine writes (used only by inbox-sync.ts)
// ---------------------------------------------------------------------------

export type ThreadUpsertInput = {
  ownerEmail: string;
  accountEmail: string;
  threadId: string;
  historyId?: string | null;
  inInbox: boolean;
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  isAutomated: boolean;
  latestDate: number;
  latestMessageId: string | null;
  subject: string;
  snippet: string;
  fromName: string;
  fromEmail: string;
  to: Array<{ name: string; email: string }>;
  labelIds: string[];
  messageIds: string[];
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  syncedAt: number;
};

export async function upsertInboxThreadRows(
  rows: ThreadUpsertInput[],
): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  const values = rows.map((r) => ({
    id: threadRowId(r.ownerEmail, r.accountEmail, r.threadId),
    ownerEmail: r.ownerEmail.toLowerCase(),
    accountEmail: r.accountEmail.toLowerCase(),
    threadId: r.threadId,
    historyId: r.historyId ?? null,
    inInbox: r.inInbox ? 1 : 0,
    isUnread: r.isUnread ? 1 : 0,
    isStarred: r.isStarred ? 1 : 0,
    isImportant: r.isImportant ? 1 : 0,
    isAutomated: r.isAutomated ? 1 : 0,
    latestDate: r.latestDate,
    latestMessageId: r.latestMessageId,
    subject: r.subject,
    snippet: r.snippet,
    fromName: r.fromName,
    fromEmail: r.fromEmail,
    toJson: JSON.stringify(r.to),
    labelIdsJson: JSON.stringify(r.labelIds),
    messageIdsJson: JSON.stringify(r.messageIds),
    messageCount: r.messageCount,
    unreadCount: r.unreadCount,
    hasAttachments: r.hasAttachments ? 1 : 0,
    syncedAt: r.syncedAt,
    updatedAt: now,
  }));

  await getDb()
    .insert(schema.mailInboxThreads)
    .values(values)
    .onConflictDoUpdate({
      target: schema.mailInboxThreads.id,
      set: {
        historyId: sql`excluded.history_id`,
        inInbox: sql`excluded.in_inbox`,
        isUnread: sql`excluded.is_unread`,
        isStarred: sql`excluded.is_starred`,
        isImportant: sql`excluded.is_important`,
        isAutomated: sql`excluded.is_automated`,
        latestDate: sql`excluded.latest_date`,
        latestMessageId: sql`excluded.latest_message_id`,
        subject: sql`excluded.subject`,
        snippet: sql`excluded.snippet`,
        fromName: sql`excluded.from_name`,
        fromEmail: sql`excluded.from_email`,
        toJson: sql`excluded.to_json`,
        labelIdsJson: sql`excluded.label_ids_json`,
        messageIdsJson: sql`excluded.message_ids_json`,
        messageCount: sql`excluded.message_count`,
        unreadCount: sql`excluded.unread_count`,
        hasAttachments: sql`excluded.has_attachments`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function deleteInboxThreadRow(
  ownerEmail: string,
  accountEmail: string,
  threadId: string,
): Promise<void> {
  await getDb()
    .delete(schema.mailInboxThreads)
    .where(
      eq(
        schema.mailInboxThreads.id,
        threadRowId(ownerEmail, accountEmail, threadId),
      ),
    );
}

/** Threads that left the inbox mid full-sync: rows not touched since `cutoffSyncedAt`. */
export async function markThreadsOutOfInboxBeforeSync(
  ownerEmail: string,
  accountEmail: string,
  cutoffSyncedAt: number,
): Promise<void> {
  await getDb()
    .update(schema.mailInboxThreads)
    .set({ inInbox: 0, updatedAt: Date.now() })
    .where(
      and(
        eq(schema.mailInboxThreads.ownerEmail, ownerEmail.toLowerCase()),
        eq(schema.mailInboxThreads.accountEmail, accountEmail.toLowerCase()),
        eq(schema.mailInboxThreads.inInbox, 1),
        lt(schema.mailInboxThreads.syncedAt, cutoffSyncedAt),
      ),
    );
}

export async function ensureSyncAccountRow(
  ownerEmail: string,
  accountEmail: string,
): Promise<SyncAccountRow> {
  const owner = ownerEmail.toLowerCase();
  const account = accountEmail.toLowerCase();
  const id = rowId(owner, account);
  const now = Date.now();
  await getDb()
    .insert(schema.mailSyncAccounts)
    .values({
      id,
      ownerEmail: owner,
      accountEmail: account,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.mailSyncAccounts.id });
  const rows = await getDb()
    .select()
    .from(schema.mailSyncAccounts)
    .where(eq(schema.mailSyncAccounts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row)
    throw new Error(`Failed to create mail_sync_accounts row for ${id}`);
  return toSyncAccountRow(row);
}

/**
 * Atomic CAS claim, same pattern as inventory-cursor.ts's
 * claimInventoryCursor: one UPDATE guarded by a WHERE that only matches an
 * unclaimed or stale-claimed row, so two concurrent Lambdas can't both sync
 * the same account at once.
 */
export async function claimSyncAccount(
  ownerEmail: string,
  accountEmail: string,
  claimTtlMs: number,
): Promise<{ claimId: string; row: SyncAccountRow } | null> {
  const owner = ownerEmail.toLowerCase();
  const account = accountEmail.toLowerCase();
  const claimId = crypto.randomUUID();
  const now = Date.now();
  const staleBefore = now - claimTtlMs;
  const rows = await getDb()
    .update(schema.mailSyncAccounts)
    .set({
      syncClaimId: claimId,
      syncClaimedAt: now,
      status: "syncing",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.mailSyncAccounts.id, rowId(owner, account)),
        or(
          isNull(schema.mailSyncAccounts.syncClaimId),
          lt(schema.mailSyncAccounts.syncClaimedAt, staleBefore),
        ),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? { claimId, row: toSyncAccountRow(row) } : null;
}

export async function releaseSyncAccount(
  ownerEmail: string,
  accountEmail: string,
  claimId: string,
  status: SyncAccountRow["status"],
): Promise<void> {
  await getDb()
    .update(schema.mailSyncAccounts)
    .set({
      syncClaimId: null,
      syncClaimedAt: null,
      status,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(schema.mailSyncAccounts.id, rowId(ownerEmail, accountEmail)),
        eq(schema.mailSyncAccounts.syncClaimId, claimId),
      ),
    );
}

export type SyncAccountPatch = Partial<{
  historyId: string | null;
  fullSyncPageToken: string | null;
  fullSyncHistoryId: string | null;
  fullSyncStartedAt: number | null;
  status: SyncAccountRow["status"];
  lastError: string | null;
  lastSyncedAt: number | null;
  labels: CachedGmailLabel[];
  labelsUpdatedAt: number;
}>;

/**
 * Updates one sync-account row. When `opts.claimId` is given, the write is
 * fenced with `AND sync_claim_id = ?` and the return value says whether a row
 * actually matched — a worker whose 90s claim TTL lapsed mid-sync (another
 * worker has since claimed the row) gets `false` back instead of silently
 * overwriting the newer worker's progress. Omit `opts` for label-cache and
 * other non-claimed writes, which stay unconditioned as before.
 */
export async function patchSyncAccount(
  ownerEmail: string,
  accountEmail: string,
  patch: SyncAccountPatch,
  opts?: { claimId?: string },
): Promise<boolean> {
  const { labels, ...rest } = patch;
  const set: Record<string, unknown> = { ...rest, updatedAt: Date.now() };
  if (labels !== undefined) set.labelsJson = JSON.stringify(labels);
  const conditions = [
    eq(schema.mailSyncAccounts.id, rowId(ownerEmail, accountEmail)),
  ];
  if (opts?.claimId) {
    conditions.push(eq(schema.mailSyncAccounts.syncClaimId, opts.claimId));
  }
  const rows = await getDb()
    .update(schema.mailSyncAccounts)
    .set(set)
    .where(and(...conditions))
    .returning({ id: schema.mailSyncAccounts.id });
  return rows.length > 0;
}

/** Clears the history watermark so the next sync step starts a fresh full sync. */
export async function resetSyncAccountProgress(
  ownerEmail: string,
  accountEmail: string,
  opts?: { claimId?: string },
): Promise<boolean> {
  return patchSyncAccount(
    ownerEmail,
    accountEmail,
    {
      historyId: null,
      fullSyncPageToken: null,
      fullSyncHistoryId: null,
      fullSyncStartedAt: null,
      status: "idle",
      lastError: null,
    },
    opts,
  );
}
