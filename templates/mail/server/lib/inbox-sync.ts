import type { InboxSyncAccountStatus } from "@shared/inbox-threads.js";

import {
  GmailQuotaCooldownError,
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
  markThreadsOutOfInboxBeforeSync,
  patchSyncAccount,
  readInboxPushGeneration,
  readInboxThreadIds,
  readSyncAccounts,
  releaseSyncAccount,
  resetSyncAccountProgress,
  SyncClaimLostError,
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
// 74 thread reads cost 2,960 units; profile and two list calls bring eager sync to 2,981.
const EAGER_COMPLETION_SIZE = 24;
const BACKFILL_PAGE_SIZE = 45;
const RECONCILE_PAGE_SIZE = 500;
const RECONCILE_HYDRATE_SIZE = 45;
const RECONCILE_MAX_PASSES = 2;
const HISTORY_PAGE_SIZE = 50;
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
    row.fullSyncPageToken != null || row.fullSyncPhase === "reconcile";
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
  lane: "incremental" | "backfill",
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
  let fullSyncHistoryId = row.fullSyncHistoryId;
  let fullSyncStartedAt = row.fullSyncStartedAt;
  if (fullSyncHistoryId == null) {
    const profile = await gmailGetProfile(accessToken, "incremental");
    fullSyncHistoryId = String(profile.historyId);
    fullSyncStartedAt = Date.now();
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncHistoryId,
      fullSyncStartedAt,
    });
  }

  let pageToken: string | undefined = row.fullSyncPageToken ?? undefined;
  const connected = await connectedEmailsLower(
    ownerEmail,
    accountEmail,
    connectedAccountEmails,
  );
  const completingEagerSlice = row.historyId == null && pageToken != null;
  const initialSync = row.historyId == null;
  const page = await gmailListThreads(
    accessToken,
    {
      q: "in:inbox",
      maxResults: initialSync
        ? completingEagerSlice
          ? EAGER_COMPLETION_SIZE
          : EAGER_PAGE_SIZE
        : BACKFILL_PAGE_SIZE,
      pageToken,
    },
    initialSync ? "incremental" : "backfill",
  );
  const ids: string[] = (page.threads ?? []).map((thread: any) => thread.id);
  if (ids.length > 0) {
    const lane = initialSync ? "incremental" : "backfill";
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

  const nextPageToken = page.nextPageToken ?? null;
  const syncedAt = Date.now();
  if (initialSync && !completingEagerSlice && nextPageToken) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncPageToken: nextPageToken,
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

  const snapshot = await readFreshInboxTotal(accessToken);
  if (fullSyncStartedAt != null) {
    await withSyncClaim(ownerEmail, accountEmail, claimId, (tx) =>
      markThreadsOutOfInboxBeforeSync(
        ownerEmail,
        accountEmail,
        fullSyncStartedAt!,
        tx,
      ),
    );
    onChanged?.();
  }
  const localInboxTotal = await countInboxThreads(ownerEmail, accountEmail);
  const reconciled = localInboxTotal === snapshot.total;
  await patchProgress(ownerEmail, accountEmail, claimId, {
    historyId,
    fullSyncPageToken: null,
    fullSyncHistoryId: null,
    fullSyncStartedAt: null,
    fullSyncPhase: reconciled ? null : "reconcile",
    fullSyncReconcilePageToken: reconciled ? null : "",
    fullSyncReconcilePendingIds: reconciled ? null : [],
    fullSyncReconcilePasses: reconciled ? 0 : 1,
    labels: snapshot.labels,
    labelsUpdatedAt: snapshot.updatedAt,
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
): Promise<SyncStepResult> {
  const snapshot = await readFreshInboxTotal(accessToken);
  const localInboxTotal = await countInboxThreads(ownerEmail, accountEmail);
  const syncedAt = Date.now();
  const matches = localInboxTotal === snapshot.total;
  if (matches) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
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
  let idsToHydrate = pendingIds.slice(0, RECONCILE_HYDRATE_SIZE);

  if (pendingIds.length === 0 && nextPageToken === null) {
    return finishReconciliationPass(
      ownerEmail,
      accountEmail,
      accessToken,
      row,
      claimId,
    );
  }

  if (pendingIds.length === 0) {
    const page = (await gmailListThreads(
      accessToken,
      {
        q: "in:inbox",
        maxResults: RECONCILE_PAGE_SIZE,
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
    nextPageToken = page.nextPageToken ?? null;
    idsToHydrate = pendingIds.slice(0, RECONCILE_HYDRATE_SIZE);
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncReconcilePageToken: nextPageToken,
      fullSyncReconcilePendingIds: pendingIds,
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
    );
  }

  return {
    status: reconciliationStatus(accountEmail, Date.now()),
    changed: idsToHydrate.length > 0,
  };
}

async function runIncrementalSyncStep(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  claimId: string,
  connectedAccountEmails?: readonly string[],
  onChanged?: () => void,
): Promise<SyncStepResult> {
  let history: any;
  try {
    history = await gmailListHistory(
      accessToken,
      {
        startHistoryId: row.historyId!,
        maxResults: HISTORY_PAGE_SIZE,
      },
      "incremental",
    );
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

  const records = history.history ?? [];
  let lastRecordId: string | null = null;
  const threadIds = new Set<string>();
  for (const record of records) {
    if (record?.id != null) lastRecordId = String(record.id);
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

  const caughtUp = !history.nextPageToken;
  const syncedAt = Date.now();
  await patchProgress(ownerEmail, accountEmail, claimId, {
    historyId: caughtUp
      ? ((history.historyId != null ? String(history.historyId) : null) ??
        lastRecordId ??
        row.historyId)
      : (lastRecordId ?? row.historyId),
    lastError: null,
    lastSyncedAt: syncedAt,
  });
  return {
    status: {
      accountEmail,
      state: caughtUp ? "ready" : "initial",
      lastSyncedAt: syncedAt,
      ...(row.fullSyncPageToken || row.fullSyncPhase === "reconcile"
        ? { backfillPending: true }
        : {}),
    },
    changed: threadIds.size > 0,
  };
}

async function failAccount(
  row: SyncAccountRow,
  claimId: string,
  err: unknown,
): Promise<InboxSyncAccountStatus> {
  const message = boundedErrorMessage(err);
  const raw = err instanceof Error ? err.message : String(err);
  const status: SyncAccountRow["status"] = isPermanentRefreshError(raw)
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
  },
): Promise<SyncInboxAccountProgress> {
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  await ensureSyncAccountRow(ownerEmail, accountEmail);
  const targetPushGeneration =
    opts?.pushGeneration ??
    (await readInboxPushGeneration(ownerEmail, accountEmail));
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
      if (
        syncResult.status.state === "ready" &&
        !syncResult.restartedFullSync &&
        Date.now() < deadline
      ) {
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
    const status = await failAccount(row, claim.claimId, err);
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
