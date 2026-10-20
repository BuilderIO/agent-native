import type { InboxSyncAccountStatus } from "@shared/inbox-threads.js";

import {
  GmailQuotaCooldownError,
  gmailGetLabel,
  gmailGetProfile,
  gmailListHistory,
  gmailListLabels,
  gmailListThreads,
  gmailBatchGetThreads,
} from "./google-api.js";
import {
  getClientForConnectedAccount,
  getConnectedAccountsWithErrors,
  getHeader,
  invalidateHistoryCacheForAccount,
  invalidateListCacheForOwner,
  isPermanentRefreshError,
  parseAddressList,
  parseEmailAddress,
} from "./google-auth.js";
import { classifyAutomated } from "./inbox-classify.js";
import {
  claimSyncAccount,
  countInboxThreads,
  deleteInboxThreadRow,
  ensureSyncAccountRow,
  INBOX_THREAD_CAP,
  markThreadsOutOfInboxBeforeSync,
  patchSyncAccount,
  purgeArchivedInboxThreadRows,
  readInboxPushGeneration,
  readInboxThreadIds,
  readSyncAccounts,
  releaseSyncAccount,
  resetSyncAccountProgress,
  SyncClaimLostError,
  trimInboxThreadRows,
  upsertInboxThreadRows,
  withSyncClaim,
  type CachedGmailLabel,
  type SyncAccountPatch,
  type SyncAccountRow,
  type ThreadUpsertInput,
} from "./inbox-store.js";

const DEFAULT_MAX_AGE_MS = 15_000;
const DEFAULT_BUDGET_MS = 6_000;
const CLAIM_TTL_MS = 90_000;
const LABELS_TTL_MS = 5 * 60 * 1000;
const EAGER_PAGE_SIZE = 50;
// Use interactive quota for the 74-thread eager slice so its first backfill page still fits.
const EAGER_COMPLETION_SIZE = 24;
// 49 reads and one threads.list call use 1,970 of the 2,000-unit backfill budget.
const BACKFILL_PAGE_SIZE = 49;
const RECONCILE_PAGE_SIZE = 500;
const RECONCILE_HYDRATE_SIZE = 45;
const RECONCILE_MAX_PASSES = 2;
const HISTORY_PAGE_SIZE = 50;
const ARCHIVE_HISTORY_PAGE_SIZE = 500;
const INBOX_HISTORY_TYPES = [
  "messageAdded",
  "messageDeleted",
  "labelAdded",
  "labelRemoved",
];
const ARCHIVE_HISTORY_TYPES = ["labelRemoved", "messageDeleted"];
// Each archive verification is a 40-unit threads.get on a lane capped at 3,000
// units a minute, and the same step may also hydrate up to 50 inbox threads at
// 40 units each. 25 verifications keep the step at 3,000 units; the rest wait
// in archive_pending_ids_json for the next step.
const ARCHIVE_VERIFY_LIMIT = 25;
const CACHE_LOOKUP_CHUNK = 500;
const HYDRATE_CHUNK = 50;

const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "List-Unsubscribe",
  "List-Id",
  "Precedence",
  "Auto-Submitted",
  "X-Auto-Response-Suppress",
  "Feedback-ID",
];

type SyncStepResult = {
  status: InboxSyncAccountStatus;
  changed: boolean;
  retryAfterSeconds?: number;
  restartedFullSync?: boolean;
};

export type SyncInboxAccountProgress = InboxSyncAccountStatus & {
  changed: boolean;
  pushGeneration: number;
  lastPushGeneration: number;
  pushPending: boolean;
  retryAfterSeconds?: number;
};

export type SyncInboxResult = {
  accounts: SyncInboxAccountProgress[];
};

function boundedErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Never let a token leak into last_error via an echoed Authorization header.
  return msg.replace(/Bearer [^\s"]+/gi, "Bearer [redacted]").slice(0, 240);
}

async function patchProgress(
  ownerEmail: string,
  accountEmail: string,
  claimId: string,
  patch: SyncAccountPatch,
): Promise<void> {
  const updated = await patchSyncAccount(ownerEmail, accountEmail, patch, {
    claimId,
  });
  if (!updated) throw new SyncClaimLostError(accountEmail);
}

function statusFromRow(row: SyncAccountRow): InboxSyncAccountStatus {
  const backfillPending =
    row.fullSyncPageToken != null ||
    row.fullSyncPhase === "reconcile" ||
    row.archivePendingIds.length > 0;
  if (row.status === "needs_reauth" || row.status === "error") {
    return {
      accountEmail: row.accountEmail,
      state: row.status,
      lastSyncedAt: row.lastSyncedAt,
      error: row.lastError ?? undefined,
      ...(backfillPending ? { backfillPending: true } : {}),
    };
  }
  return {
    accountEmail: row.accountEmail,
    state:
      row.historyId == null || row.status === "syncing" ? "initial" : "ready",
    lastSyncedAt: row.lastSyncedAt,
    ...(backfillPending ? { backfillPending: true } : {}),
  };
}

function cachedGmailLabels(result: any): CachedGmailLabel[] {
  return (result.labels ?? []).map((label: any) => ({
    id: label.id,
    name: label.name,
    type: label.type,
    color: label.color?.backgroundColor,
    messagesTotal: label.messagesTotal,
    messagesUnread: label.messagesUnread,
    threadsTotal: label.threadsTotal,
    threadsUnread: label.threadsUnread,
  }));
}

function inboxThreadTotal(labels: CachedGmailLabel[]): number {
  const rawTotal = labels.find(
    (label) => label.id.toUpperCase() === "INBOX",
  )?.threadsTotal;
  const total = Number(rawTotal);
  if (rawTotal == null || !Number.isSafeInteger(total) || total < 0) {
    throw new Error("Gmail did not return a valid INBOX thread total");
  }
  return total;
}

async function readFreshInboxTotal(
  accessToken: string,
): Promise<{ labels: CachedGmailLabel[]; total: number; updatedAt: number }> {
  const labels = cachedGmailLabels(
    await gmailListLabels(accessToken, "backfill"),
  );
  const inboxLabel = await gmailGetLabel(accessToken, "INBOX", "backfill");
  const detailedInbox = cachedGmailLabels({ labels: [inboxLabel] })[0];
  const existingInboxIndex = labels.findIndex(
    (label) => label.id.toUpperCase() === "INBOX",
  );
  if (existingInboxIndex >= 0) {
    labels[existingInboxIndex] = {
      ...labels[existingInboxIndex],
      ...detailedInbox,
    };
  } else {
    labels.push(detailedInbox);
  }
  return { labels, total: inboxThreadTotal(labels), updatedAt: Date.now() };
}

function reconciliationStatus(
  accountEmail: string,
  lastSyncedAt: number,
  error?: string,
): InboxSyncAccountStatus {
  return {
    accountEmail,
    state: error ? "error" : "ready",
    lastSyncedAt,
    ...(error ? { error } : {}),
    backfillPending: true,
  };
}

async function connectedEmailsLower(
  ownerEmail: string,
  accountEmail: string,
  connectedAccountEmails?: readonly string[],
): Promise<Set<string>> {
  const accounts =
    connectedAccountEmails ??
    (await getConnectedAccountsWithErrors(ownerEmail)).accounts;
  return new Set([
    ...accounts.map((a) => a.toLowerCase()),
    accountEmail.toLowerCase(),
  ]);
}

function messageLabels(m: any): string[] {
  return m.labelIds || [];
}

function deriveRowFromThread(
  thread: any,
  ownerEmail: string,
  accountEmail: string,
  connectedEmailsLower: Set<string>,
  syncedAt: number,
): ThreadUpsertInput | null {
  const messages: any[] = thread.messages || [];
  if (messages.length === 0) return null;
  const nonDraft = messages.filter((m) => !messageLabels(m).includes("DRAFT"));
  const relevant = nonDraft.length > 0 ? nonDraft : messages;
  if (relevant.length === 0) return null;

  const latest = relevant.reduce((a, b) =>
    Number(b.internalDate ?? 0) > Number(a.internalDate ?? 0) ? b : a,
  );

  const labelSet = new Set<string>();
  let isUnread = false;
  let isStarred = false;
  let isImportant = false;
  let inInbox = false;
  for (const m of relevant) {
    const labels = messageLabels(m);
    for (const l of labels) labelSet.add(l);
    if (labels.includes("UNREAD")) isUnread = true;
    if (labels.includes("STARRED")) isStarred = true;
    if (labels.includes("IMPORTANT")) isImportant = true;
    if (labels.includes("INBOX") && !labels.includes("TRASH")) inInbox = true;
  }

  const bySentDateDesc = [...relevant].sort(
    (a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0),
  );
  const classified =
    bySentDateDesc.find((m) => {
      const from = parseEmailAddress(getHeader(m.payload?.headers, "From"));
      return !connectedEmailsLower.has(from.email.toLowerCase());
    }) ?? latest;

  const classifiedHeaders = classified.payload?.headers || [];
  const from = parseEmailAddress(getHeader(classifiedHeaders, "From"));
  const to = parseAddressList(getHeader(classifiedHeaders, "To"));
  const isAutomated = classifyAutomated({
    headers: classifiedHeaders,
    labelIds: [...labelSet],
    fromEmail: from.email,
  });

  const hasAttachments = relevant.some((m) =>
    (m.payload?.parts || []).some((p: any) => !!p.filename),
  );

  return {
    ownerEmail,
    accountEmail,
    threadId: thread.id,
    historyId: thread.historyId != null ? String(thread.historyId) : null,
    inInbox,
    isUnread,
    isStarred,
    isImportant,
    isAutomated,
    latestDate: Number(latest.internalDate ?? Date.now()),
    latestMessageId: latest.id ?? null,
    subject: getHeader(latest.payload?.headers, "Subject"),
    // Stored HTML-escaped, as Gmail returns it; inboxRowToItem decodes it.
    // Decoding here too would turn a sender's literal "&lt;" into "<".
    snippet: thread.snippet ?? latest.snippet ?? "",
    fromName: from.name,
    fromEmail: from.email,
    to,
    labelIds: [...labelSet],
    messageIds: messages.map((m) => m.id).filter(Boolean),
    messageCount: messages.length,
    unreadCount: relevant.filter((m) => messageLabels(m).includes("UNREAD"))
      .length,
    hasAttachments,
    syncedAt,
  };
}

async function hydrateAndApply(
  accessToken: string,
  ids: string[],
  ownerEmail: string,
  accountEmail: string,
  connected: Set<string>,
  claimId: string,
  lane: "interactive" | "incremental" | "backfill",
  onChanged?: () => void,
): Promise<void> {
  for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
    const chunk = ids.slice(i, i + HYDRATE_CHUNK);
    const readStartedAt = Date.now();
    const upserts: ThreadUpsertInput[] = [];
    const deletes: Array<{ id: string; readStartedAt: number }> = [];
    const results = await gmailBatchGetThreads(
      accessToken,
      chunk,
      "metadata",
      METADATA_HEADERS,
      lane,
    );
    for (const part of results) {
      if (part.error) {
        if (/HTTP 404/.test(part.error)) {
          deletes.push({ id: part.id, readStartedAt });
          continue;
        }
        throw new Error(`Gmail thread ${part.id} fetch failed: ${part.error}`);
      }
      const derived = deriveRowFromThread(
        part.data,
        ownerEmail,
        accountEmail,
        connected,
        readStartedAt,
      );
      if (derived) upserts.push(derived);
      else deletes.push({ id: part.id, readStartedAt });
    }
    await withSyncClaim(ownerEmail, accountEmail, claimId, async (tx) => {
      if (upserts.length > 0) await upsertInboxThreadRows(upserts, tx);
      for (const { id, readStartedAt } of deletes)
        await deleteInboxThreadRow(
          ownerEmail,
          accountEmail,
          id,
          readStartedAt,
          tx,
        );
    });
    if (upserts.length > 0 || deletes.length > 0) onChanged?.();
  }
}

async function runFullSyncStep(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  claimId: string,
  connectedAccountEmails?: readonly string[],
  onChanged?: () => void,
): Promise<SyncStepResult> {
  const initialSync = row.historyId == null;
  let fullSyncHistoryId = row.fullSyncHistoryId;
  let fullSyncStartedAt = row.fullSyncStartedAt;
  let listed = row.fullSyncListedCount;
  if (fullSyncHistoryId == null) {
    const profile = await gmailGetProfile(
      accessToken,
      initialSync ? "interactive" : "incremental",
    );
    fullSyncHistoryId = String(profile.historyId);
    fullSyncStartedAt = Date.now();
    listed = 0;
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncHistoryId,
      fullSyncStartedAt,
      fullSyncListedCount: 0,
    });
  }

  let pageToken: string | undefined = row.fullSyncPageToken ?? undefined;
  const connected = await connectedEmailsLower(
    ownerEmail,
    accountEmail,
    connectedAccountEmails,
  );
  const completingEagerSlice = row.historyId == null && pageToken != null;
  const lane = initialSync ? "interactive" : "backfill";
  const pageSize = initialSync
    ? completingEagerSlice
      ? EAGER_COMPLETION_SIZE
      : EAGER_PAGE_SIZE
    : BACKFILL_PAGE_SIZE;
  const page = await gmailListThreads(
    accessToken,
    {
      q: "in:inbox",
      maxResults: Math.min(pageSize, INBOX_THREAD_CAP - listed),
      pageToken,
    },
    lane,
  );
  const ids: string[] = (page.threads ?? []).map((thread: any) => thread.id);
  if (ids.length > 0) {
    await hydrateAndApply(
      accessToken,
      ids,
      ownerEmail,
      accountEmail,
      connected,
      claimId,
      lane,
      onChanged,
    );
  }

  // Gmail lists newest first, so stopping at the cap keeps the newest threads.
  // The token is dropped on the same step, so a capped walk never resumes.
  listed += ids.length;
  const truncated = listed >= INBOX_THREAD_CAP && Boolean(page.nextPageToken);
  const nextPageToken = truncated ? null : (page.nextPageToken ?? null);
  const syncedAt = Date.now();
  if (initialSync && !completingEagerSlice && nextPageToken) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncPageToken: nextPageToken,
      fullSyncListedCount: listed,
      lastError: null,
      lastSyncedAt: syncedAt,
    });
    return {
      status: {
        accountEmail,
        state: "initial",
        lastSyncedAt: syncedAt,
        backfillPending: true,
      },
      changed: ids.length > 0,
    };
  }

  const historyId = initialSync ? fullSyncHistoryId : row.historyId;
  if (nextPageToken) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      historyId,
      fullSyncPageToken: nextPageToken,
      fullSyncHistoryId,
      fullSyncStartedAt,
      fullSyncListedCount: listed,
      lastError: null,
      lastSyncedAt: syncedAt,
    });
    return {
      status: {
        accountEmail,
        state: "ready",
        lastSyncedAt: syncedAt,
        backfillPending: true,
      },
      changed: ids.length > 0,
    };
  }

  // A capped walk is only the newest slice of the inbox, so there is no full
  // Gmail total to reconcile against: skip the label snapshot and reconcile.
  const snapshot = truncated ? null : await readFreshInboxTotal(accessToken);
  if (fullSyncStartedAt != null) {
    await withSyncClaim(ownerEmail, accountEmail, claimId, async (tx) => {
      await markThreadsOutOfInboxBeforeSync(
        ownerEmail,
        accountEmail,
        fullSyncStartedAt!,
        tx,
      );
      await trimInboxThreadRows(ownerEmail, accountEmail, INBOX_THREAD_CAP, tx);
    });
    onChanged?.();
  }
  const localInboxTotal = snapshot
    ? await countInboxThreads(ownerEmail, accountEmail)
    : 0;
  const reconciled = !snapshot || localInboxTotal === snapshot.total;
  await patchProgress(ownerEmail, accountEmail, claimId, {
    historyId,
    fullSyncPageToken: null,
    fullSyncHistoryId: null,
    fullSyncStartedAt: null,
    fullSyncPhase: reconciled ? null : "reconcile",
    fullSyncReconcilePageToken: reconciled ? null : "",
    fullSyncReconcilePendingIds: reconciled ? null : [],
    fullSyncReconcilePasses: reconciled ? 0 : 1,
    fullSyncListedCount: 0,
    ...(snapshot
      ? { labels: snapshot.labels, labelsUpdatedAt: snapshot.updatedAt }
      : {}),
    lastError: null,
    lastSyncedAt: syncedAt,
  });
  return {
    status: reconciled
      ? { accountEmail, state: "ready", lastSyncedAt: syncedAt }
      : reconciliationStatus(accountEmail, syncedAt),
    changed: true,
  };
}

async function finishReconciliationPass(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  claimId: string,
  listedAtCap: boolean,
): Promise<SyncStepResult> {
  const snapshot = await readFreshInboxTotal(accessToken);
  if (listedAtCap && snapshot.total > INBOX_THREAD_CAP) {
    // The listing stopped at the cap with more inbox behind it, so Gmail's
    // total no longer matches the local slice; finish without the comparison.
    // An inbox of exactly the cap is a complete listing and compares below.
    const syncedAt = Date.now();
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncPhase: null,
      fullSyncReconcilePageToken: null,
      fullSyncReconcilePendingIds: null,
      fullSyncReconcilePasses: 0,
      fullSyncHistoryId: null,
      fullSyncStartedAt: null,
      fullSyncListedCount: 0,
      labels: snapshot.labels,
      labelsUpdatedAt: snapshot.updatedAt,
      lastError: null,
      lastSyncedAt: syncedAt,
    });
    return {
      status: { accountEmail, state: "ready", lastSyncedAt: syncedAt },
      changed: true,
    };
  }
  const localInboxTotal = await countInboxThreads(ownerEmail, accountEmail);
  const syncedAt = Date.now();
  const matches = localInboxTotal === snapshot.total;
  if (matches) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncListedCount: 0,
      fullSyncPhase: null,
      fullSyncReconcilePageToken: null,
      fullSyncReconcilePendingIds: null,
      fullSyncReconcilePasses: 0,
      fullSyncHistoryId: null,
      fullSyncStartedAt: null,
      labels: snapshot.labels,
      labelsUpdatedAt: snapshot.updatedAt,
      lastError: null,
      lastSyncedAt: syncedAt,
    });
    return {
      status: { accountEmail, state: "ready", lastSyncedAt: syncedAt },
      changed: true,
    };
  }

  if (row.fullSyncReconcilePasses < RECONCILE_MAX_PASSES) {
    const passes = row.fullSyncReconcilePasses + 1;
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncPhase: "reconcile",
      fullSyncReconcilePageToken: "",
      fullSyncReconcilePendingIds: [],
      fullSyncReconcilePasses: passes,
      fullSyncListedCount: 0,
      labels: snapshot.labels,
      labelsUpdatedAt: snapshot.updatedAt,
      lastError: null,
      lastSyncedAt: syncedAt,
    });
    return {
      status: reconciliationStatus(accountEmail, syncedAt),
      changed: true,
    };
  }

  console.warn("[inbox-sync] Inbox reconciliation ended with count mismatch", {
    accountEmail,
    localInboxTotal,
    gmailInboxTotal: snapshot.total,
  });
  await patchProgress(ownerEmail, accountEmail, claimId, {
    fullSyncListedCount: 0,
    fullSyncPhase: null,
    fullSyncReconcilePageToken: null,
    fullSyncReconcilePendingIds: null,
    fullSyncReconcilePasses: 0,
    fullSyncHistoryId: null,
    fullSyncStartedAt: null,
    labels: snapshot.labels,
    labelsUpdatedAt: snapshot.updatedAt,
    lastError: null,
    lastSyncedAt: syncedAt,
  });
  return {
    status: { accountEmail, state: "ready", lastSyncedAt: syncedAt },
    changed: true,
  };
}

async function runReconciliationStep(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  claimId: string,
  connectedAccountEmails?: readonly string[],
  onChanged?: () => void,
): Promise<SyncStepResult> {
  let pendingIds = row.fullSyncReconcilePendingIds ?? [];
  let nextPageToken = row.fullSyncReconcilePageToken;
  let listed = row.fullSyncListedCount;
  let idsToHydrate = pendingIds.slice(0, RECONCILE_HYDRATE_SIZE);

  if (pendingIds.length === 0 && nextPageToken === null) {
    return finishReconciliationPass(
      ownerEmail,
      accountEmail,
      accessToken,
      row,
      claimId,
      listed >= INBOX_THREAD_CAP,
    );
  }

  if (pendingIds.length === 0) {
    const page = (await gmailListThreads(
      accessToken,
      {
        q: "in:inbox",
        maxResults: Math.min(RECONCILE_PAGE_SIZE, INBOX_THREAD_CAP - listed),
        pageToken: nextPageToken || undefined,
      },
      "backfill",
    )) as {
      threads?: Array<{ id?: string | null }>;
      nextPageToken?: string | null;
    };
    const pageIds = [
      ...new Set(
        (page.threads ?? []).flatMap((thread) =>
          typeof thread.id === "string" ? [thread.id] : [],
        ),
      ),
    ];
    const localIds = await readInboxThreadIds(
      ownerEmail,
      accountEmail,
      pageIds,
    );
    pendingIds = pageIds.filter((id) => !localIds.has(id));
    listed += pageIds.length;
    nextPageToken =
      listed >= INBOX_THREAD_CAP ? null : (page.nextPageToken ?? null);
    idsToHydrate = pendingIds.slice(0, RECONCILE_HYDRATE_SIZE);
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncReconcilePageToken: nextPageToken,
      fullSyncReconcilePendingIds: pendingIds,
      fullSyncListedCount: listed,
    });
  }

  if (idsToHydrate.length > 0) {
    const connected = await connectedEmailsLower(
      ownerEmail,
      accountEmail,
      connectedAccountEmails,
    );
    await hydrateAndApply(
      accessToken,
      idsToHydrate,
      ownerEmail,
      accountEmail,
      connected,
      claimId,
      "backfill",
      onChanged,
    );
    pendingIds = pendingIds.slice(idsToHydrate.length);
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncReconcilePendingIds: pendingIds,
    });
  }

  if (pendingIds.length === 0 && nextPageToken === null) {
    const verifiedRow = {
      ...row,
      fullSyncReconcilePageToken: null,
      fullSyncReconcilePendingIds: [],
    };
    return finishReconciliationPass(
      ownerEmail,
      accountEmail,
      accessToken,
      verifiedRow,
      claimId,
      listed >= INBOX_THREAD_CAP,
    );
  }

  return {
    status: reconciliationStatus(accountEmail, Date.now()),
    changed: idsToHydrate.length > 0,
  };
}

// Gmail history ids are decimal strings that can pass 2^53, so they are never
// compared as Numbers.
function compareHistoryIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// Null means the stream constrains nothing: it finished and reported neither a
// head nor any records. An unfinished stream with no records holds the cursor.
function streamWatermark(
  page: { historyId?: unknown },
  caughtUp: boolean,
  lastRecordId: string | null,
  startHistoryId: string,
): string | null {
  if (!caughtUp) return lastRecordId ?? startHistoryId;
  if (page.historyId != null) return String(page.historyId);
  return lastRecordId;
}

// Two history streams share one cursor. The inbox stream uses Gmail's labelId
// filter, so only messages that carry INBOX are returned and new mail that skips
// the inbox (auto-archive filters) never reaches threads.get. Gmail's docs do not
// say whether an INBOX removal is still returned under that filter, so the
// archive stream reads label removals unfiltered and only uses their thread ids
// to delete rows. It never fetches a thread.
async function runIncrementalSyncStep(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  claimId: string,
  connectedAccountEmails?: readonly string[],
  onChanged?: () => void,
): Promise<SyncStepResult> {
  const readStartedAt = Date.now();
  let inboxHistory: any;
  let archiveHistory: any;
  try {
    [inboxHistory, archiveHistory] = await Promise.all([
      gmailListHistory(
        accessToken,
        {
          startHistoryId: row.historyId!,
          historyTypes: INBOX_HISTORY_TYPES,
          labelId: "INBOX",
          maxResults: HISTORY_PAGE_SIZE,
        },
        "incremental",
      ),
      gmailListHistory(
        accessToken,
        {
          startHistoryId: row.historyId!,
          historyTypes: ARCHIVE_HISTORY_TYPES,
          maxResults: ARCHIVE_HISTORY_PAGE_SIZE,
        },
        "incremental",
      ),
    ]);
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\(404\)/.test(message)) {
      const reset = await resetSyncAccountProgress(ownerEmail, accountEmail, {
        claimId,
      });
      if (!reset) throw new SyncClaimLostError(accountEmail);
      const freshRow: SyncAccountRow = {
        ...row,
        historyId: null,
        fullSyncPageToken: null,
        fullSyncHistoryId: null,
        fullSyncStartedAt: null,
        fullSyncPhase: null,
        fullSyncReconcilePageToken: null,
        fullSyncReconcilePendingIds: null,
        fullSyncReconcilePasses: 0,
        fullSyncListedCount: 0,
        archivePendingIds: [],
      };
      const restarted = await runFullSyncStep(
        ownerEmail,
        accountEmail,
        accessToken,
        freshRow,
        claimId,
        connectedAccountEmails,
        onChanged,
      );
      return { ...restarted, restartedFullSync: true };
    }
    throw err;
  }

  const inboxRecords = inboxHistory.history ?? [];
  let lastInboxRecordId: string | null = null;
  const threadIds = new Set<string>();
  for (const record of inboxRecords) {
    if (record?.id != null) lastInboxRecordId = String(record.id);
    for (const bucket of [
      record.messagesAdded,
      record.messagesDeleted,
      record.labelsAdded,
      record.labelsRemoved,
    ]) {
      for (const entry of bucket ?? []) {
        if (entry?.message?.threadId) threadIds.add(entry.message.threadId);
      }
    }
  }

  let lastArchiveRecordId: string | null = null;
  const archivedThreadIds = new Set<string>();
  for (const record of archiveHistory.history ?? []) {
    if (record?.id != null) lastArchiveRecordId = String(record.id);
    for (const entry of record.labelsRemoved ?? []) {
      const threadId = entry?.message?.threadId;
      if (threadId && (entry.labelIds ?? []).includes("INBOX")) {
        archivedThreadIds.add(threadId);
      }
    }
    for (const entry of record.messagesDeleted ?? []) {
      if (entry?.message?.threadId)
        archivedThreadIds.add(entry.message.threadId);
    }
  }
  // One message losing INBOX, or being deleted, does not remove a thread: the
  // row is deleted only when a minimal read shows no message in it still
  // carries INBOX (a 404 means the thread is gone). A thread the inbox stream
  // returned is hydrated anyway, and a thread with no cached in-inbox row has
  // nothing to delete. Reads per step are bounded by the quota lane; the rest
  // carry over in archivePendingIds, so a large burst finishes over several
  // steps instead of failing the same oversized read on every retry.
  const archiveCandidates = [
    ...new Set([...row.archivePendingIds, ...archivedThreadIds]),
  ].filter((threadId) => !threadIds.has(threadId));
  const cachedCandidates = new Set<string>();
  for (let i = 0; i < archiveCandidates.length; i += CACHE_LOOKUP_CHUNK) {
    for (const threadId of await readInboxThreadIds(
      ownerEmail,
      accountEmail,
      archiveCandidates.slice(i, i + CACHE_LOOKUP_CHUNK),
    )) {
      cachedCandidates.add(threadId);
    }
  }
  const unverified = archiveCandidates.filter((threadId) =>
    cachedCandidates.has(threadId),
  );
  const verifyNow = unverified.slice(0, ARCHIVE_VERIFY_LIMIT);
  const archivePendingIds = unverified.slice(ARCHIVE_VERIFY_LIMIT);
  const archivedOnly: string[] = [];
  if (verifyNow.length > 0) {
    const verification = await gmailBatchGetThreads(
      accessToken,
      verifyNow,
      "minimal",
      undefined,
      "incremental",
    );
    for (const part of verification) {
      if (part.error) {
        if (/HTTP 404/.test(part.error)) {
          archivedOnly.push(part.id);
          continue;
        }
        throw new Error(`Gmail thread ${part.id} fetch failed: ${part.error}`);
      }
      const stillInInbox = (part.data?.messages ?? []).some((message: any) =>
        (message?.labelIds ?? []).includes("INBOX"),
      );
      if (stillInInbox) threadIds.add(part.id);
      else archivedOnly.push(part.id);
    }
  }

  if (threadIds.size > 0) {
    const connected = await connectedEmailsLower(
      ownerEmail,
      accountEmail,
      connectedAccountEmails,
    );
    await hydrateAndApply(
      accessToken,
      [...threadIds],
      ownerEmail,
      accountEmail,
      connected,
      claimId,
      "incremental",
      onChanged,
    );
  }

  // Archived rows are deleted at once on an archive event. Rows the inbox stream
  // wrote as archived are short-lived, so every step purges the expired ones.
  // Only new in-inbox rows can push the account past the cap, so the trim runs
  // when the inbox stream changed.
  await withSyncClaim(ownerEmail, accountEmail, claimId, async (tx) => {
    for (const threadId of archivedOnly) {
      await deleteInboxThreadRow(
        ownerEmail,
        accountEmail,
        threadId,
        readStartedAt,
        tx,
      );
    }
    await purgeArchivedInboxThreadRows(
      ownerEmail,
      accountEmail,
      Date.now(),
      tx,
    );
    if (threadIds.size > 0) {
      await trimInboxThreadRows(ownerEmail, accountEmail, INBOX_THREAD_CAP, tx);
    }
  });
  if (archivedOnly.length > 0) onChanged?.();

  // The two streams are separate reads and can report different mailbox heads,
  // so the cursor moves only to the lowest point both have fully processed: a
  // finished stream contributes its head, an unfinished one its last record.
  // The next step rereads from there; both writes are idempotent.
  const inboxCaughtUp = !inboxHistory.nextPageToken;
  const archiveCaughtUp = !archiveHistory.nextPageToken;
  const syncedAt = Date.now();
  const watermarks = [
    streamWatermark(
      inboxHistory,
      inboxCaughtUp,
      lastInboxRecordId,
      row.historyId!,
    ),
    streamWatermark(
      archiveHistory,
      archiveCaughtUp,
      lastArchiveRecordId,
      row.historyId!,
    ),
  ].filter((value): value is string => value != null);
  const historyId =
    watermarks.length > 0
      ? watermarks.reduce((a, b) => (compareHistoryIds(b, a) < 0 ? b : a))
      : row.historyId!;
  await patchProgress(ownerEmail, accountEmail, claimId, {
    historyId,
    archivePendingIds,
    lastError: null,
    lastSyncedAt: syncedAt,
  });
  return {
    status: {
      accountEmail,
      state: inboxCaughtUp && archiveCaughtUp ? "ready" : "initial",
      lastSyncedAt: syncedAt,
      ...(row.fullSyncPageToken ||
      row.fullSyncPhase === "reconcile" ||
      archivePendingIds.length > 0
        ? { backfillPending: true }
        : {}),
    },
    changed: threadIds.size > 0 || archivedOnly.length > 0,
  };
}

function isGmailAuthRejection(err: unknown): boolean {
  return (err as { status?: unknown } | null)?.status === 401;
}

async function failAccount(
  row: SyncAccountRow,
  claimId: string,
  err: unknown,
  afterTokenRefresh = false,
): Promise<InboxSyncAccountStatus> {
  const message = boundedErrorMessage(err);
  const raw = err instanceof Error ? err.message : String(err);
  // Only Google refusing the refresh itself, or rejecting a token it has just
  // minted, proves the credential is dead; a 401 on an older token does not.
  const status: SyncAccountRow["status"] =
    isPermanentRefreshError(raw) ||
    (afterTokenRefresh && isGmailAuthRejection(err))
      ? "needs_reauth"
      : "error";
  invalidateHistoryCacheForAccount(row.accountEmail);
  invalidateListCacheForOwner(row.ownerEmail);
  await patchSyncAccount(
    row.ownerEmail,
    row.accountEmail,
    { status, lastError: message },
    { claimId },
  );
  await releaseSyncAccount(row.ownerEmail, row.accountEmail, claimId, status);
  return {
    accountEmail: row.accountEmail,
    state: status,
    lastSyncedAt: row.lastSyncedAt,
    error: message,
  };
}

function progressFromStatus(
  status: InboxSyncAccountStatus,
  pushGeneration: number,
  lastPushGeneration: number,
  changed = false,
  retryAfterSeconds?: number,
): SyncInboxAccountProgress {
  return {
    ...status,
    changed,
    pushGeneration,
    lastPushGeneration,
    pushPending: pushGeneration > lastPushGeneration,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

export async function syncInboxAccount(
  ownerEmail: string,
  accountEmail: string,
  opts?: {
    budgetMs?: number;
    force?: boolean;
    connectedAccountEmails?: readonly string[];
    pushGeneration?: number;
    /** Internal: this attempt runs on a token refreshed after a 401. */
    afterTokenRefresh?: boolean;
  },
): Promise<SyncInboxAccountProgress> {
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  const existing = await ensureSyncAccountRow(ownerEmail, accountEmail);
  const targetPushGeneration =
    opts?.pushGeneration ??
    (await readInboxPushGeneration(ownerEmail, accountEmail));
  // Google rejected this credential: syncing it again only repeats the 401.
  // Reconnecting (or an explicit resync) clears the state.
  if (existing.status === "needs_reauth") {
    return progressFromStatus(
      statusFromRow(existing),
      targetPushGeneration,
      existing.lastPushGeneration,
    );
  }
  const claim = await claimSyncAccount(ownerEmail, accountEmail, CLAIM_TTL_MS);
  if (!claim) {
    const current = (await readSyncAccounts(ownerEmail)).find(
      (r) => r.accountEmail === accountEmail.toLowerCase(),
    );
    return progressFromStatus(
      current
        ? statusFromRow(current)
        : { accountEmail, state: "initial", lastSyncedAt: null },
      await readInboxPushGeneration(ownerEmail, accountEmail),
      current?.lastPushGeneration ?? 0,
    );
  }

  let row = claim.row;
  let changed = false;
  try {
    const client = await getClientForConnectedAccount(ownerEmail, accountEmail);
    if (!client) {
      throw new Error("Google account not connected");
    }
    const accessToken = client.accessToken;

    const labelsStale =
      opts?.force ||
      row.labelsUpdatedAt == null ||
      Date.now() - row.labelsUpdatedAt > LABELS_TTL_MS;
    if (
      labelsStale &&
      row.historyId != null &&
      row.fullSyncPhase !== "reconcile" &&
      Date.now() < deadline
    ) {
      const result = await gmailListLabels(accessToken, "incremental");
      const labels: CachedGmailLabel[] = (result.labels ?? []).map(
        (l: any) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          color: l.color?.backgroundColor,
          messagesTotal: l.messagesTotal,
          messagesUnread: l.messagesUnread,
          threadsTotal: l.threadsTotal,
          threadsUnread: l.threadsUnread,
        }),
      );
      const labelsUpdatedAt = Date.now();
      await patchProgress(ownerEmail, accountEmail, claim.claimId, {
        labels,
        labelsUpdatedAt,
      });
      row = { ...row, labels, labelsUpdatedAt };
      changed = true;
    }

    if (Date.now() >= deadline) {
      await releaseSyncAccount(ownerEmail, accountEmail, claim.claimId, "idle");
      const latest = (await readSyncAccounts(ownerEmail)).find(
        (account) => account.accountEmail === accountEmail.toLowerCase(),
      );
      return progressFromStatus(
        latest
          ? statusFromRow(latest)
          : { accountEmail, state: "initial", lastSyncedAt: row.lastSyncedAt },
        await readInboxPushGeneration(ownerEmail, accountEmail),
        latest?.lastPushGeneration ?? row.lastPushGeneration,
        changed,
      );
    }

    let syncResult: SyncStepResult;
    if (row.fullSyncPhase === "reconcile") {
      syncResult = await runIncrementalSyncStep(
        ownerEmail,
        accountEmail,
        accessToken,
        row,
        claim.claimId,
        opts?.connectedAccountEmails,
        () => {
          changed = true;
        },
      );
      if (!syncResult.restartedFullSync && Date.now() < deadline) {
        const incrementalResult = syncResult;
        const reconciliationResult = await runReconciliationStep(
          ownerEmail,
          accountEmail,
          accessToken,
          row,
          claim.claimId,
          opts?.connectedAccountEmails,
          () => {
            changed = true;
          },
        );
        syncResult = {
          ...reconciliationResult,
          status: {
            ...reconciliationResult.status,
            state:
              incrementalResult.status.state === "initial"
                ? "initial"
                : reconciliationResult.status.state,
          },
          changed: incrementalResult.changed || reconciliationResult.changed,
        };
      }
    } else if (row.historyId == null) {
      syncResult = await runFullSyncStep(
        ownerEmail,
        accountEmail,
        accessToken,
        row,
        claim.claimId,
        opts?.connectedAccountEmails,
        () => {
          changed = true;
        },
      );
    } else {
      syncResult = await runIncrementalSyncStep(
        ownerEmail,
        accountEmail,
        accessToken,
        row,
        claim.claimId,
        opts?.connectedAccountEmails,
        () => {
          changed = true;
        },
      );
      if (
        !syncResult.restartedFullSync &&
        row.fullSyncPageToken != null &&
        Date.now() < deadline
      ) {
        const incrementalResult = syncResult;
        const backfillResult = await runFullSyncStep(
          ownerEmail,
          accountEmail,
          accessToken,
          row,
          claim.claimId,
          opts?.connectedAccountEmails,
          () => {
            changed = true;
          },
        );
        syncResult = {
          ...backfillResult,
          status: {
            ...backfillResult.status,
            state:
              incrementalResult.status.state === "initial"
                ? "initial"
                : backfillResult.status.state,
          },
          changed: incrementalResult.changed || backfillResult.changed,
        };
      }
    }

    const accountStatus = syncResult.status;
    changed ||= syncResult.changed;
    const dbStatus: SyncAccountRow["status"] =
      accountStatus.state === "error" || accountStatus.state === "needs_reauth"
        ? accountStatus.state
        : "idle";
    if (syncResult.changed) invalidateHistoryCacheForAccount(accountEmail);
    invalidateListCacheForOwner(ownerEmail);
    if (
      accountStatus.state === "ready" &&
      targetPushGeneration > row.lastPushGeneration
    ) {
      await patchProgress(ownerEmail, accountEmail, claim.claimId, {
        lastPushGeneration: targetPushGeneration,
      });
    }
    await releaseSyncAccount(ownerEmail, accountEmail, claim.claimId, dbStatus);
    const latest = (await readSyncAccounts(ownerEmail)).find(
      (account) => account.accountEmail === accountEmail.toLowerCase(),
    );
    return progressFromStatus(
      accountStatus,
      await readInboxPushGeneration(ownerEmail, accountEmail),
      latest?.lastPushGeneration ?? row.lastPushGeneration,
      changed,
    );
  } catch (err) {
    if (err instanceof GmailQuotaCooldownError) {
      await releaseSyncAccount(ownerEmail, accountEmail, claim.claimId, "idle");
      const latest = (await readSyncAccounts(ownerEmail)).find(
        (account) => account.accountEmail === accountEmail.toLowerCase(),
      );
      const status: InboxSyncAccountStatus = {
        ...statusFromRow(latest ?? row),
        state: "initial",
      };
      return progressFromStatus(
        status,
        await readInboxPushGeneration(ownerEmail, accountEmail),
        latest?.lastPushGeneration ?? row.lastPushGeneration,
        changed,
        err.details.retryAfterSeconds,
      );
    }
    if (err instanceof SyncClaimLostError) {
      invalidateHistoryCacheForAccount(accountEmail);
      invalidateListCacheForOwner(ownerEmail);
      const latest = (await readSyncAccounts(ownerEmail)).find(
        (account) => account.accountEmail === accountEmail.toLowerCase(),
      );
      return progressFromStatus(
        latest
          ? statusFromRow(latest)
          : { accountEmail, state: "initial", lastSyncedAt: row.lastSyncedAt },
        await readInboxPushGeneration(ownerEmail, accountEmail),
        latest?.lastPushGeneration ?? row.lastPushGeneration,
        changed,
      );
    }
    let failure = err;
    if (isGmailAuthRejection(err) && !opts?.afterTokenRefresh) {
      // Google can retire an access token before its stated expiry: refresh
      // it once and retry on the fresh token before judging the credential.
      let refreshed = false;
      try {
        await getClientForConnectedAccount(ownerEmail, accountEmail, {
          forceRefresh: true,
        });
        refreshed = true;
      } catch (refreshError) {
        failure = refreshError;
      }
      if (refreshed) {
        await releaseSyncAccount(
          ownerEmail,
          accountEmail,
          claim.claimId,
          "idle",
        );
        const retried = await syncInboxAccount(ownerEmail, accountEmail, {
          ...opts,
          budgetMs: Math.max(0, deadline - Date.now()),
          afterTokenRefresh: true,
        });
        return changed ? { ...retried, changed: true } : retried;
      }
    }
    const status = await failAccount(
      row,
      claim.claimId,
      failure,
      opts?.afterTokenRefresh,
    );
    return progressFromStatus(
      status,
      await readInboxPushGeneration(ownerEmail, accountEmail),
      row.lastPushGeneration,
      changed,
    );
  }
}

export async function ensureInboxFresh(
  ownerEmail: string,
  opts?: { accountEmails?: string[]; maxAgeMs?: number; budgetMs?: number },
): Promise<InboxSyncAccountStatus[]> {
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;

  const { accounts, errors: lookupErrors } =
    await getConnectedAccountsWithErrors(ownerEmail);
  const requested = opts?.accountEmails?.length
    ? new Set(opts.accountEmails.map((e) => e.toLowerCase()))
    : null;
  const requestedAccountsAreKnown =
    requested !== null &&
    [...requested].every((email) =>
      accounts.some((account) => account.toLowerCase() === email),
    );
  const relevantLookupErrors = requestedAccountsAreKnown ? [] : lookupErrors;
  const emails = accounts
    .map((email) => email.toLowerCase())
    .filter((email) => !requested || requested.has(email));

  const now = Date.now();
  const statuses = await Promise.all(
    emails.map(async (accountEmail) => {
      const row = await ensureSyncAccountRow(ownerEmail, accountEmail);
      const pushGeneration = await readInboxPushGeneration(
        ownerEmail,
        accountEmail,
      );
      const fresh =
        row.lastPushGeneration >= pushGeneration &&
        row.lastSyncedAt != null &&
        now - row.lastSyncedAt < maxAgeMs;
      if (fresh) return statusFromRow(row);
      try {
        const result = await syncInboxAccount(ownerEmail, accountEmail, {
          budgetMs,
          connectedAccountEmails: accounts,
          pushGeneration,
        });
        return result;
      } catch (err) {
        return {
          accountEmail,
          state: "error" as const,
          lastSyncedAt: row.lastSyncedAt,
          error: boundedErrorMessage(err),
        };
      }
    }),
  );
  return [
    ...statuses,
    ...relevantLookupErrors.map(({ email, error }) => ({
      accountEmail: email,
      state: "error" as const,
      lastSyncedAt: null,
      error: boundedErrorMessage(error),
    })),
  ];
}

export async function syncInbox(
  ownerEmail: string,
  opts?: { accountEmails?: string[]; budgetMs?: number },
): Promise<SyncInboxResult> {
  const { accounts, errors: lookupErrors } =
    await getConnectedAccountsWithErrors(ownerEmail);
  const requested = opts?.accountEmails?.length
    ? new Set(opts.accountEmails.map((email) => email.toLowerCase()))
    : null;
  const emails = accounts
    .map((email) => email.toLowerCase())
    .filter((email) => !requested || requested.has(email));
  const relevantLookupErrors =
    requested && [...requested].every((email) => emails.includes(email))
      ? []
      : lookupErrors;

  const progress = await Promise.all(
    emails.map((accountEmail) =>
      syncInboxAccount(ownerEmail, accountEmail, {
        budgetMs: opts?.budgetMs ?? 1_800,
        connectedAccountEmails: accounts,
      }),
    ),
  );
  const disconnected = requested
    ? [...requested]
        .filter((email) => !emails.includes(email))
        .map((accountEmail) =>
          progressFromStatus(
            {
              accountEmail,
              state: "error",
              lastSyncedAt: null,
              error: "Account is not connected",
            },
            0,
            0,
          ),
        )
    : [];
  return {
    accounts: [
      ...progress,
      ...disconnected,
      ...relevantLookupErrors.map(({ email, error }) =>
        progressFromStatus(
          {
            accountEmail: email,
            state: "error",
            lastSyncedAt: null,
            error: boundedErrorMessage(error),
          },
          0,
          0,
        ),
      ),
    ],
  };
}

export async function resetInboxSync(
  ownerEmail: string,
  accountEmail?: string,
): Promise<void> {
  if (accountEmail) {
    await resetSyncAccountProgress(ownerEmail, accountEmail);
    return;
  }
  const { accounts: emails, errors } =
    await getConnectedAccountsWithErrors(ownerEmail);
  await Promise.all(
    emails.map((email) => resetSyncAccountProgress(ownerEmail, email)),
  );
  if (errors.length > 0) {
    throw new Error(errors.map(({ error }) => error).join("; "));
  }
}
