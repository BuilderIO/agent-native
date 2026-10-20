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
import { mergeSyncStatuses, statusFromRow } from "./inbox-status.js";
import {
  appendHydratePendingIds,
  claimSyncAccount,
  countInboxThreads,
  tryDeleteInboxThreadRow,
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
  type SyncDegraded,
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
// Thread reads one incremental step may make: 70 x 40 units plus the two
// 2-unit history reads stays under the 3,000-unit incremental lane.
const STEP_THREAD_READS = 70;
// Of those, the share archive verification keeps when new mail also waits.
const VERIFY_MIN_SHARE = 20;
// Reads each step reserves, per list, for threads that failed before, so a
// steady backlog of new mail cannot starve their retries.
const RETRY_SHARE = 5;
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

// Error class only (never a message, id or address): what a degraded status
// reports so callers can tell it apart from success.
function failureKind(error: unknown): string {
  if (typeof error === "string") {
    const http = /HTTP (\d{3})/.exec(error);
    return http ? `http_${http[1]}` : "gmail_read_failed";
  }
  return error instanceof Error ? error.name || "error" : "error";
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
  // Ids whose delete the write guard skipped (a row updated after the read).
  // Required: dropping them would leave the stale row cached for good.
  requeueSkipped: (threadIds: string[]) => Promise<void> | void,
  onChanged?: () => void,
  // When given, a thread whose read fails (not a 404) is recorded here with its
  // failure kind and the rest still apply, instead of the whole call throwing.
  failed?: Map<string, string>,
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
        if (failed) {
          failed.set(part.id, failureKind(part.error));
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
    const skipped = await withSyncClaim(
      ownerEmail,
      accountEmail,
      claimId,
      async (tx) => {
        if (upserts.length > 0) await upsertInboxThreadRows(upserts, tx);
        const skippedIds: string[] = [];
        for (const { id, readStartedAt } of deletes) {
          const outcome = await tryDeleteInboxThreadRow(
            ownerEmail,
            accountEmail,
            id,
            readStartedAt,
            tx,
          );
          if (outcome === "skipped") skippedIds.push(id);
        }
        return skippedIds;
      },
    );
    if (skipped.length > 0) await requeueSkipped(skipped);
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
      (skipped) =>
        appendHydratePendingIds(ownerEmail, accountEmail, claimId, skipped),
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

  // Only the first full sync sets the cursors. A backfill step runs after the
  // incremental step in the same call and holds the pre-incremental row, so
  // writing its cursor back would rewind history.
  const cursors = initialSync
    ? { historyId: fullSyncHistoryId, archiveHistoryId: null }
    : {};
  if (nextPageToken) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      ...cursors,
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
    ...cursors,
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
      (skipped) =>
        appendHydratePendingIds(ownerEmail, accountEmail, claimId, skipped),
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
  // Each stream keeps its own cursor, so a lagging archive stream never makes
  // the inbox stream reread events it already applied.
  const archiveStart = row.archiveHistoryId ?? row.historyId!;
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
          startHistoryId: archiveStart,
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
        archiveHistoryId: null,
        fullSyncPageToken: null,
        fullSyncHistoryId: null,
        fullSyncStartedAt: null,
        fullSyncPhase: null,
        fullSyncReconcilePageToken: null,
        fullSyncReconcilePendingIds: null,
        fullSyncReconcilePasses: 0,
        fullSyncListedCount: 0,
        archivePendingIds: [],
        hydratePendingIds: [],
        degraded: { hydrate: [], verify: [], kind: null },
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
  // A finished stream moves its cursor to its own head, an unfinished one to
  // its last record. Everything either stream returned is queued in the pending
  // lists below before the cursors move, so neither stream skips an event.
  const inboxCaughtUp = !inboxHistory.nextPageToken;
  const archiveCaughtUp = !archiveHistory.nextPageToken;
  const historyId =
    streamWatermark(
      inboxHistory,
      inboxCaughtUp,
      lastInboxRecordId,
      row.historyId!,
    ) ?? row.historyId!;
  const archiveHistoryId =
    streamWatermark(
      archiveHistory,
      archiveCaughtUp,
      lastArchiveRecordId,
      archiveStart,
    ) ?? archiveStart;

  // One message losing INBOX, or being deleted, does not remove a thread: the
  // row is deleted only when a minimal read shows no message in it still
  // carries INBOX (a 404 means the thread is gone). A thread the inbox stream
  // returned is hydrated anyway, and a thread with no cached in-inbox row has
  // nothing to delete.
  // Threads that failed before are retried every step but queue last and stay
  // out of the pending lists, which hold only work the next step will attempt.
  const priorFailedHydrate = new Set(row.degraded.hydrate);
  const priorFailedVerify = new Set(row.degraded.verify);
  const hydrateQueue = [
    ...new Set([
      ...row.hydratePendingIds,
      ...threadIds,
      ...row.degraded.hydrate,
    ]),
  ];
  const archiveCandidates = [
    ...new Set([
      ...row.archivePendingIds,
      ...archivedThreadIds,
      ...row.degraded.verify,
    ]),
  ];
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
  // A candidate that is also being hydrated is settled by the hydrated payload
  // (an archived thread is written out of the inbox), so it is not read twice.
  // It stays an archive candidate until that hydration succeeds, so a failed
  // hydration cannot lose the archive event.
  const hydrateQueueSet = new Set(hydrateQueue);
  const archiveOverlap = archiveCandidates.filter(
    (threadId) =>
      hydrateQueueSet.has(threadId) && cachedCandidates.has(threadId),
  );
  const verifyQueue = archiveCandidates.filter(
    (threadId) =>
      !hydrateQueueSet.has(threadId) && cachedCandidates.has(threadId),
  );

  // Every thread read costs 40 units of the 3,000-unit incremental lane and the
  // two history reads cost 4, so one step reads at most STEP_THREAD_READS
  // threads. Hydration goes first, but verification always keeps a share so a
  // steady stream of new mail cannot starve archive handling. What does not fit
  // waits in the pending lists.
  const hydrateRetry = hydrateQueue.filter((id) => priorFailedHydrate.has(id));
  const hydrateFresh = hydrateQueue.filter((id) => !priorFailedHydrate.has(id));
  const verifyRetry = verifyQueue.filter((id) => priorFailedVerify.has(id));
  const verifyFresh = verifyQueue.filter((id) => !priorFailedVerify.has(id));
  const retryHydrateReads = Math.min(RETRY_SHARE, hydrateRetry.length);
  const retryVerifyReads = Math.min(RETRY_SHARE, verifyRetry.length);
  const freshBudget = STEP_THREAD_READS - retryHydrateReads - retryVerifyReads;
  const hydrateFreshNow = hydrateFresh.slice(
    0,
    verifyFresh.length > 0 ? freshBudget - VERIFY_MIN_SHARE : freshBudget,
  );
  const verifyFreshNow = verifyFresh.slice(
    0,
    freshBudget - hydrateFreshNow.length,
  );
  // Reads fresh work left unused go to more retries, hydration first.
  let spare = freshBudget - hydrateFreshNow.length - verifyFreshNow.length;
  const extraHydrate = Math.min(spare, hydrateRetry.length - retryHydrateReads);
  spare -= extraHydrate;
  const extraVerify = Math.min(spare, verifyRetry.length - retryVerifyReads);
  const hydrateNow = [
    ...hydrateFreshNow,
    ...hydrateRetry.slice(0, retryHydrateReads + extraHydrate),
  ];
  const verifyNow = [
    ...verifyFreshNow,
    ...verifyRetry.slice(0, retryVerifyReads + extraVerify),
  ];
  const hydrateNowSet = new Set(hydrateNow);
  const verifyNowSet = new Set(verifyNow);

  // Record the cursors and every unprocessed id before any thread read, so a
  // quota failure or crash mid-step retries the pending ids instead of
  // replaying the same history page.
  await patchProgress(ownerEmail, accountEmail, claimId, {
    historyId,
    archiveHistoryId,
    archiveHistoryPending: !archiveCaughtUp,
    // The pending lists below overwrite any unreadable column, so its raw value
    // is saved first and the account stays degraded until a resync.
    ...(Object.keys(row.corrupt).length > 0 ? { corrupt: row.corrupt } : {}),
    hydratePendingIds: hydrateQueue.filter((id) => !priorFailedHydrate.has(id)),
    archivePendingIds: [
      ...verifyQueue.filter((id) => !priorFailedVerify.has(id)),
      ...archiveOverlap,
    ],
  });

  const archivedOnly: string[] = [];
  const stillInbox: string[] = [];
  // A candidate whose read fails is isolated: it goes to the back of the queue
  // and the step carries on, so one bad thread cannot block verification of
  // the rest or hydration of new mail. A quota cooldown ends verification for
  // this step and leaves the candidates where they were.
  const verifyFailed = new Map<string, string>();
  let verifyCooledDown = false;
  if (verifyNow.length > 0) {
    let verification: Awaited<ReturnType<typeof gmailBatchGetThreads>> = [];
    try {
      verification = await gmailBatchGetThreads(
        accessToken,
        verifyNow,
        "minimal",
        undefined,
        "incremental",
      );
    } catch (error) {
      if (error instanceof GmailQuotaCooldownError) {
        verifyCooledDown = true;
      } else {
        const kind = failureKind(error);
        console.warn("[inbox-sync] archive verification batch failed", {
          kind,
        });
        for (const id of verifyNow) verifyFailed.set(id, kind);
      }
    }
    for (const part of verification) {
      if (part.error) {
        if (/HTTP 404/.test(part.error)) {
          archivedOnly.push(part.id);
        } else {
          console.warn("[inbox-sync] archive verification read failed", {
            error: boundedErrorMessage(part.error),
          });
          verifyFailed.set(part.id, failureKind(part.error));
        }
        continue;
      }
      const keeps = (part.data?.messages ?? []).some((message: any) =>
        (message?.labelIds ?? []).includes("INBOX"),
      );
      if (keeps) stillInbox.push(part.id);
      else archivedOnly.push(part.id);
    }
  }

  // A thread that fails to hydrate goes to the back of the queue; a failure of
  // the whole read (quota, network) is rethrown only after the archive cleanup
  // and the pending lists below are saved, so it cannot block either.
  const hydrateFailed = new Map<string, string>();
  // Deletes the write guard skipped: requeued so the stale row is retried.
  const hydrateSkipped: string[] = [];
  let hydrateError: unknown = null;
  if (hydrateNow.length > 0) {
    try {
      const connected = await connectedEmailsLower(
        ownerEmail,
        accountEmail,
        connectedAccountEmails,
      );
      await hydrateAndApply(
        accessToken,
        hydrateNow,
        ownerEmail,
        accountEmail,
        connected,
        claimId,
        "incremental",
        (skipped) => {
          hydrateSkipped.push(...skipped);
        },
        onChanged,
        hydrateFailed,
      );
    } catch (error) {
      if (error instanceof SyncClaimLostError) throw error;
      hydrateError = error;
    }
  }

  // Archived rows are deleted at once on an archive event. Rows the inbox stream
  // wrote as archived are short-lived, so every step purges the expired ones.
  // Only new in-inbox rows can push the account past the cap, so the trim runs
  // when the inbox stream changed.
  const archiveSkipped: string[] = [];
  await withSyncClaim(ownerEmail, accountEmail, claimId, async (tx) => {
    for (const threadId of archivedOnly) {
      const removed = await tryDeleteInboxThreadRow(
        ownerEmail,
        accountEmail,
        threadId,
        readStartedAt,
        tx,
      );
      if (removed === "skipped") archiveSkipped.push(threadId);
    }
    await purgeArchivedInboxThreadRows(
      ownerEmail,
      accountEmail,
      Date.now(),
      tx,
    );
    if (hydrateNow.length > 0) {
      await trimInboxThreadRows(ownerEmail, accountEmail, INBOX_THREAD_CAP, tx);
    }
  });
  if (archivedOnly.length > 0) onChanged?.();

  // Verified threads that still have INBOX mail are refreshed on the next step,
  // which keeps this step inside its read budget. Untried queue entries that
  // had failed before go back to the degraded lists with the new failures.
  // After a whole-read failure the ids just tried go behind the untried ones,
  // so a batch that keeps failing cannot hold the front of the retry order.
  const hydrateUntried = [
    ...hydrateQueue.filter((id) => !hydrateNowSet.has(id)),
    ...(hydrateError ? hydrateNow : []),
  ];
  const verifyUntried = [
    ...(verifyCooledDown ? verifyNow : []),
    ...verifyQueue.filter((id) => !verifyNowSet.has(id)),
  ];
  const hydratePendingIds = [
    ...new Set([
      ...hydrateUntried.filter((id) => !priorFailedHydrate.has(id)),
      ...stillInbox,
      ...hydrateSkipped,
    ]),
  ];
  // Overlap ids leave the archive list only once their hydration succeeded.
  const hydrateSucceeded = (id: string) =>
    hydrateNowSet.has(id) && !hydrateError && !hydrateFailed.has(id);
  const archivePendingIds = [
    ...verifyUntried.filter((id) => !priorFailedVerify.has(id)),
    ...archiveSkipped,
    ...archiveOverlap.filter((id) => !hydrateSucceeded(id)),
  ];
  const failureKinds = [...hydrateFailed.values(), ...verifyFailed.values()];
  const degraded: SyncDegraded = {
    hydrate: [
      ...new Set([
        ...hydrateUntried.filter((id) => priorFailedHydrate.has(id)),
        ...hydrateFailed.keys(),
      ]),
    ],
    verify: [
      ...new Set([
        ...verifyUntried.filter((id) => priorFailedVerify.has(id)),
        ...verifyFailed.keys(),
      ]),
    ],
    kind: failureKinds[failureKinds.length - 1] ?? row.degraded.kind,
  };
  const corruptCount = Object.keys(row.corrupt).length;
  const degradedCount =
    degraded.hydrate.length + degraded.verify.length + corruptCount;
  const syncedAt = Date.now();
  if (hydrateError) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      hydratePendingIds,
      archivePendingIds,
      degraded,
    });
    throw hydrateError;
  }
  await patchProgress(ownerEmail, accountEmail, claimId, {
    hydratePendingIds,
    archivePendingIds,
    degraded,
    lastError: null,
    lastSyncedAt: syncedAt,
  });
  return {
    status: {
      accountEmail,
      state: inboxCaughtUp && archiveCaughtUp ? "ready" : "initial",
      lastSyncedAt: syncedAt,
      // Full-sync flags come from the step that runs them; the caller adds them
      // when this step is the only one that ran.
      ...(hydratePendingIds.length > 0 ||
      archivePendingIds.some((id) => !degraded.hydrate.includes(id)) ||
      !archiveCaughtUp
        ? { backfillPending: true }
        : {}),
      // Threads that keep failing are reported as degraded, not as pending
      // work, so status says "pending" only for what the next step attempts.
      ...(degradedCount > 0
        ? {
            degraded: {
              count: degradedCount,
              kind:
                corruptCount > 0
                  ? "corrupt_state"
                  : (degraded.kind ?? "unknown"),
            },
          }
        : {}),
    },
    changed: hydrateNow.length > 0 || archivedOnly.length > 0,
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
    // True while the status is the incremental step's alone, so it still has to
    // carry the full-sync flags no later step reports.
    let incrementalAlone = false;
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
      incrementalAlone = !syncResult.restartedFullSync;
      if (!syncResult.restartedFullSync && Date.now() < deadline) {
        incrementalAlone = false;
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
          status: mergeSyncStatuses(
            incrementalResult.status,
            reconciliationResult.status,
          ),
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
      incrementalAlone = !syncResult.restartedFullSync;
      if (
        !syncResult.restartedFullSync &&
        row.fullSyncPageToken != null &&
        Date.now() < deadline
      ) {
        incrementalAlone = false;
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
          status: mergeSyncStatuses(
            incrementalResult.status,
            backfillResult.status,
          ),
          changed: incrementalResult.changed || backfillResult.changed,
        };
      }
    }

    const accountStatus: InboxSyncAccountStatus =
      incrementalAlone &&
      (row.fullSyncPageToken != null || row.fullSyncPhase === "reconcile")
        ? { ...syncResult.status, backfillPending: true }
        : syncResult.status;
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
