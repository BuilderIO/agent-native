import type { InboxThreadItem } from "@shared/inbox-threads.js";
import type { EmailMessage, Label } from "@shared/types.js";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

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
  lastPushGeneration: number;
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
    lastPushGeneration: row.lastPushGeneration,
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
    .orderBy(
      desc(schema.mailInboxThreads.latestDate),
      desc(schema.mailInboxThreads.latestMessageId),
      desc(schema.mailInboxThreads.id),
    );
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

export type LocalLabelDelta = {
  add?: string[];
  remove?: string[];
  providerHistoryId?: string;
  scope?: "thread" | "message";
  messageIds?: string[];
};

const LOCAL_MUTATION_INBOX = 1;
const LOCAL_MUTATION_UNREAD = 2;
const LOCAL_MUTATION_STARRED = 4;
const LOCAL_MUTATION_IMPORTANT = 8;
const LOCAL_MUTATION_LABELS = 16;
const LOCAL_MUTATION_LABEL_NAMES = new Set([
  "INBOX",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
]);

function numericHistoryId(value: string | null | undefined): string | null {
  return value && /^\d+$/.test(value) ? value : null;
}

function newestHistoryId(
  current: string | null | undefined,
  next: string | undefined,
): string | null {
  const currentId = numericHistoryId(current);
  const nextId = numericHistoryId(next);
  if (!currentId) return nextId;
  if (!nextId) return currentId;
  return BigInt(nextId) > BigInt(currentId) ? nextId : currentId;
}

export async function applyLocalLabelDelta(
  ownerEmail: string,
  accountEmail: string,
  threadIds: string[],
  delta: LocalLabelDelta,
): Promise<void> {
  if (threadIds.length === 0) return;
  const ids = threadIds.map((t) => threadRowId(ownerEmail, accountEmail, t));
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({
        id: schema.mailInboxThreads.id,
        labelIdsJson: schema.mailInboxThreads.labelIdsJson,
        messageIdsJson: schema.mailInboxThreads.messageIdsJson,
        localMutationHistoryId: schema.mailInboxThreads.localMutationHistoryId,
        localMutationFields: schema.mailInboxThreads.localMutationFields,
      })
      .from(schema.mailInboxThreads)
      .where(inArray(schema.mailInboxThreads.id, ids))
      .orderBy(schema.mailInboxThreads.id)
      .for("update");
    if (rows.length === 0) return;

    const add = delta.add ?? [];
    const remove = new Set(delta.remove ?? []);
    const now = Date.now();
    const messageScoped = delta.scope === "message";
    let mutationFields = 0;
    if (
      add.includes("INBOX") ||
      add.includes("TRASH") ||
      remove.has("INBOX") ||
      remove.has("TRASH")
    )
      mutationFields |= LOCAL_MUTATION_INBOX;
    if (add.includes("UNREAD") || remove.has("UNREAD"))
      mutationFields |= LOCAL_MUTATION_UNREAD;
    if (add.includes("STARRED") || remove.has("STARRED"))
      mutationFields |= LOCAL_MUTATION_STARRED;
    if (add.includes("IMPORTANT") || remove.has("IMPORTANT"))
      mutationFields |= LOCAL_MUTATION_IMPORTANT;
    if (
      [...add, ...remove].some(
        (label) => !LOCAL_MUTATION_LABEL_NAMES.has(label),
      ) ||
      add.includes("TRASH") ||
      remove.has("TRASH")
    )
      mutationFields |= LOCAL_MUTATION_LABELS;
    if (messageScoped && add.includes("STARRED"))
      mutationFields |= LOCAL_MUTATION_LABELS;

    for (const row of rows) {
      const labels = new Set(parseJsonArray<string>(row.labelIdsJson, []));
      // UNREAD/STARRED are handled separately below, not applied blindly
      // here: at message scope the delta only describes the last-touched
      // message, not the thread's whole state, so the union must be derived
      // from the recomputed unread count / an add-only star rule instead.
      for (const l of remove)
        if (!messageScoped || (l !== "UNREAD" && l !== "STARRED"))
          labels.delete(l);
      for (const l of add)
        if (!messageScoped || (l !== "UNREAD" && l !== "STARRED"))
          labels.add(l);

      const set: Record<string, unknown> = {
        inInbox: labels.has("INBOX") && !labels.has("TRASH") ? 1 : 0,
        isImportant: labels.has("IMPORTANT") ? 1 : 0,
        updatedAt: now,
      };

      const localMutationFields =
        (row.localMutationFields ?? 0) | mutationFields;
      if (localMutationFields > 0) {
        set.localMutationAt = now;
        const providerHistoryId = numericHistoryId(delta.providerHistoryId);
        const priorFields = row.localMutationFields ?? 0;
        const priorFenceLost = priorFields > 0 && !row.localMutationHistoryId;
        set.localMutationHistoryId =
          providerHistoryId && !priorFenceLost
            ? newestHistoryId(row.localMutationHistoryId, providerHistoryId)
            : null;
        set.localMutationFields = localMutationFields;
      }

      if (!messageScoped) {
        set.isUnread = labels.has("UNREAD") ? 1 : 0;
        set.isStarred = labels.has("STARRED") ? 1 : 0;
        if (mutationFields & LOCAL_MUTATION_UNREAD) {
          const messageCount = parseJsonArray<string>(
            row.messageIdsJson,
            [],
          ).length;
          set.unreadCount = labels.has("UNREAD") ? messageCount : 0;
        }
      } else {
        if (delta.add?.includes("STARRED")) {
          set.isStarred = 1;
          labels.add("STARRED");
        }
        // Removing STARRED at message scope is intentionally a no-op — for
        // isStarred and for the union label set: we don't track which
        // individual message(s) hold the star, so we can't tell whether
        // another message in the thread is still starred. The next history
        // sync (within the 15s freshness window) refetches the thread from
        // Gmail and corrects it.
      }

      set.labelIdsJson = JSON.stringify([...labels]);
      await tx
        .update(schema.mailInboxThreads)
        .set(set)
        .where(eq(schema.mailInboxThreads.id, row.id));
    }
  });
}

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
  db: any = getDb(),
): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  const values = [...rows]
    .sort((a, b) =>
      threadRowId(a.ownerEmail, a.accountEmail, a.threadId).localeCompare(
        threadRowId(b.ownerEmail, b.accountEmail, b.threadId),
      ),
    )
    .map((r) => ({
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
      localMutationAt: null,
      localMutationHistoryId: null,
      localMutationFields: null,
    }));

  await db
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
        localMutationAt: sql`excluded.local_mutation_at`,
        localMutationHistoryId: sql`excluded.local_mutation_history_id`,
        localMutationFields: sql`excluded.local_mutation_fields`,
      },
      setWhere: sql`
        excluded.synced_at > ${schema.mailInboxThreads.updatedAt}
        AND (
          ${schema.mailInboxThreads.localMutationAt} IS NULL
          OR (
            ${schema.mailInboxThreads.localMutationFields} IS NOT NULL
            AND (
              (
                (${schema.mailInboxThreads.localMutationFields} & ${LOCAL_MUTATION_INBOX}) = 0
                OR excluded.in_inbox = ${schema.mailInboxThreads.inInbox}
              )
              AND (
                (${schema.mailInboxThreads.localMutationFields} & ${LOCAL_MUTATION_UNREAD}) = 0
                OR (
                  excluded.is_unread IS NOT DISTINCT FROM ${schema.mailInboxThreads.isUnread}
                  AND excluded.unread_count IS NOT DISTINCT FROM ${schema.mailInboxThreads.unreadCount}
                )
              )
              AND (
                (${schema.mailInboxThreads.localMutationFields} & ${LOCAL_MUTATION_STARRED}) = 0
                OR excluded.is_starred IS NOT DISTINCT FROM ${schema.mailInboxThreads.isStarred}
              )
              AND (
                (${schema.mailInboxThreads.localMutationFields} & ${LOCAL_MUTATION_IMPORTANT}) = 0
                OR excluded.is_important IS NOT DISTINCT FROM ${schema.mailInboxThreads.isImportant}
              )
              AND (
                (${schema.mailInboxThreads.localMutationFields} & ${LOCAL_MUTATION_LABELS}) = 0
                OR excluded.label_ids_json = ${schema.mailInboxThreads.labelIdsJson}
              )
            )
          )
        )
      `,
    });
}

export async function deleteInboxThreadRow(
  ownerEmail: string,
  accountEmail: string,
  threadId: string,
  readStartedAt?: number,
  db: any = getDb(),
): Promise<void> {
  const conditions = [
    eq(
      schema.mailInboxThreads.id,
      threadRowId(ownerEmail, accountEmail, threadId),
    ),
  ];
  if (readStartedAt !== undefined) {
    conditions.push(lt(schema.mailInboxThreads.updatedAt, readStartedAt));
  }
  await db.delete(schema.mailInboxThreads).where(and(...conditions));
}

export async function markThreadsOutOfInboxBeforeSync(
  ownerEmail: string,
  accountEmail: string,
  cutoffSyncedAt: number,
  db: any = getDb(),
): Promise<void> {
  await db
    .update(schema.mailInboxThreads)
    .set({ inInbox: 0, updatedAt: Date.now() })
    .where(
      and(
        eq(schema.mailInboxThreads.ownerEmail, ownerEmail.toLowerCase()),
        eq(schema.mailInboxThreads.accountEmail, accountEmail.toLowerCase()),
        eq(schema.mailInboxThreads.inInbox, 1),
        lt(schema.mailInboxThreads.syncedAt, cutoffSyncedAt),
        lt(schema.mailInboxThreads.updatedAt, cutoffSyncedAt),
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

export class SyncClaimLostError extends Error {
  constructor(accountEmail: string) {
    super(`Sync claim for ${accountEmail} was lost to another worker`);
    this.name = "SyncClaimLostError";
  }
}

export async function withSyncClaim<T>(
  ownerEmail: string,
  accountEmail: string,
  claimId: string,
  write: (tx: any) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx: any) => {
    const rows = await tx
      .select({ syncClaimId: schema.mailSyncAccounts.syncClaimId })
      .from(schema.mailSyncAccounts)
      .where(eq(schema.mailSyncAccounts.id, rowId(ownerEmail, accountEmail)))
      .for("update")
      .limit(1);
    if (rows[0]?.syncClaimId !== claimId)
      throw new SyncClaimLostError(accountEmail);

    return write(tx);
  });
}

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
  lastPushGeneration: number;
  syncClaimId: string | null;
  syncClaimedAt: number | null;
  labels: CachedGmailLabel[];
  labelsUpdatedAt: number;
}>;

export async function recordInboxPushInvalidation(
  ownerEmail: string,
  accountEmail: string,
): Promise<void> {
  await getDb()
    .insert(schema.mailInboxPushInvalidations)
    .values({
      id: rowId(ownerEmail, accountEmail),
      ownerEmail: ownerEmail.toLowerCase(),
      accountEmail: accountEmail.toLowerCase(),
      generation: 1,
    })
    .onConflictDoUpdate({
      target: schema.mailInboxPushInvalidations.id,
      set: {
        generation: sql`${schema.mailInboxPushInvalidations.generation} + 1`,
      },
    });
}

export async function readInboxPushGeneration(
  ownerEmail: string,
  accountEmail: string,
): Promise<number> {
  const rows = await getDb()
    .select({ generation: schema.mailInboxPushInvalidations.generation })
    .from(schema.mailInboxPushInvalidations)
    .where(
      and(
        eq(
          schema.mailInboxPushInvalidations.ownerEmail,
          ownerEmail.toLowerCase(),
        ),
        eq(
          schema.mailInboxPushInvalidations.accountEmail,
          accountEmail.toLowerCase(),
        ),
      ),
    );
  return rows.reduce((total, row) => total + row.generation, 0);
}

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
      syncClaimId: null,
      syncClaimedAt: null,
    },
    opts,
  );
}
