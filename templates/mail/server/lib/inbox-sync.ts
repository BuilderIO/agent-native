/**
 * The inbox sync engine: keeps `mail_inbox_threads` fresh from Gmail via a
 * resumable full sync (first run) followed by incremental `history.list`
 * deltas. Gmail traffic per call is bounded — history.list (2 units) plus
 * batched threads.get for changed threads only — instead of the live
 * messages.list page every list/count used to cost (see google-api.ts's
 * quota bucket / cooldown for why that mattered).
 */
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import type { InboxSyncAccountStatus } from "@shared/inbox-threads.js";

import {
  gmailGetProfile,
  gmailListHistory,
  gmailListLabels,
  gmailListThreads,
  gmailBatchGetThreads,
} from "./google-api.js";
import {
  getClientForConnectedAccount,
  getConnectedAccounts,
  getHeader,
  invalidateListCacheForOwner,
  isPermanentRefreshError,
  parseAddressList,
  parseEmailAddress,
} from "./google-auth.js";
import { classifyAutomated } from "./inbox-classify.js";
import {
  assertSyncClaimHeld,
  claimSyncAccount,
  deleteInboxThreadRow,
  ensureSyncAccountRow,
  markThreadsOutOfInboxBeforeSync,
  patchSyncAccount,
  readSyncAccounts,
  releaseSyncAccount,
  resetSyncAccountProgress,
  SyncClaimLostError,
  upsertInboxThreadRows,
  type CachedGmailLabel,
  type SyncAccountPatch,
  type SyncAccountRow,
  type ThreadUpsertInput,
} from "./inbox-store.js";

const DEFAULT_MAX_AGE_MS = 15_000;
const DEFAULT_BUDGET_MS = 6_000;
const CLAIM_TTL_MS = 90_000;
const LABELS_TTL_MS = 5 * 60 * 1000;
const FULL_SYNC_PAGE_SIZE = 100;
const HYDRATE_CHUNK = 50;

// Requested on every thread hydrate (full + incremental) — the fields
// classifyAutomated and the row derivation need without paying for `full`
// format (bodies).
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

function boundedErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Never let a token leak into last_error via an echoed Authorization header.
  return msg.replace(/Bearer [^\s"]+/gi, "Bearer [redacted]").slice(0, 240);
}

/** Fenced progress write: throws {@link SyncClaimLostError} instead of silently no-oping. */
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
  if (row.status === "needs_reauth" || row.status === "error") {
    return {
      accountEmail: row.accountEmail,
      state: row.status,
      lastSyncedAt: row.lastSyncedAt,
      error: row.lastError ?? undefined,
    };
  }
  return {
    accountEmail: row.accountEmail,
    state: row.historyId == null ? "initial" : "ready",
    lastSyncedAt: row.lastSyncedAt,
  };
}

async function connectedEmailsLower(ownerEmail: string): Promise<Set<string>> {
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  return new Set(accounts.map((a) => a.accountId.toLowerCase()));
}

function messageLabels(m: any): string[] {
  return m.labelIds || [];
}

/**
 * Turns one Gmail thread (format=metadata) into an upsertable row, or null
 * for a degenerate thread with no usable messages (never upserted — any
 * stale row for it should be dropped by the caller instead).
 */
function deriveRowFromThread(
  thread: any,
  ownerEmail: string,
  accountEmail: string,
  connectedEmailsLower: Set<string>,
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

  // Classification target: the latest message NOT sent from one of the
  // owner's own connected accounts, so replying to your own thread never
  // reclassifies it. Falls back to the latest message if every message in
  // the thread was self-sent.
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

  // metadata format omits `parts` on most responses — this only ever
  // reports true when Gmail happens to include them; false means "unknown",
  // never a guess.
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
    syncedAt: Date.now(),
  };
}

/** Hydrates thread ids in chunks of ≤50; a per-thread 404 is skipped (the thread never existed as a row). */
async function hydrateThreads(
  accessToken: string,
  ids: string[],
  ownerEmail: string,
  accountEmail: string,
  connected: Set<string>,
): Promise<ThreadUpsertInput[]> {
  const rows: ThreadUpsertInput[] = [];
  for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
    const chunk = ids.slice(i, i + HYDRATE_CHUNK);
    const results = await gmailBatchGetThreads(
      accessToken,
      chunk,
      "metadata",
      METADATA_HEADERS,
    );
    for (const part of results) {
      if (part.error) {
        if (/HTTP 404/.test(part.error)) continue;
        throw new Error(`Gmail thread ${part.id} fetch failed: ${part.error}`);
      }
      const derived = deriveRowFromThread(
        part.data,
        ownerEmail,
        accountEmail,
        connected,
      );
      if (derived) rows.push(derived);
    }
  }
  return rows;
}

/** Same as hydrateThreads, but a 404 means "delete the existing row" (incremental path — the thread was known before). */
async function hydrateAndApply(
  accessToken: string,
  ids: string[],
  ownerEmail: string,
  accountEmail: string,
  connected: Set<string>,
  claimId: string,
): Promise<void> {
  const upserts: ThreadUpsertInput[] = [];
  const deletes: string[] = [];
  for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
    const chunk = ids.slice(i, i + HYDRATE_CHUNK);
    const results = await gmailBatchGetThreads(
      accessToken,
      chunk,
      "metadata",
      METADATA_HEADERS,
    );
    for (const part of results) {
      if (part.error) {
        if (/HTTP 404/.test(part.error)) {
          deletes.push(part.id);
          continue;
        }
        throw new Error(`Gmail thread ${part.id} fetch failed: ${part.error}`);
      }
      const derived = deriveRowFromThread(
        part.data,
        ownerEmail,
        accountEmail,
        connected,
      );
      if (derived) upserts.push(derived);
      else deletes.push(part.id);
    }
  }
  // Fenced immediately before this step's row writes: a claim lost to a
  // newer worker during the Gmail round trips above must not land here.
  await assertSyncClaimHeld(ownerEmail, accountEmail, claimId);
  if (upserts.length > 0) await upsertInboxThreadRows(upserts);
  for (const id of deletes)
    await deleteInboxThreadRow(ownerEmail, accountEmail, id);
}

async function runFullSyncStep(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  deadline: number,
  claimId: string,
): Promise<InboxSyncAccountStatus> {
  let fullSyncHistoryId = row.fullSyncHistoryId;
  let fullSyncStartedAt = row.fullSyncStartedAt;
  if (fullSyncHistoryId == null) {
    const profile = await gmailGetProfile(accessToken);
    fullSyncHistoryId = String(profile.historyId);
    fullSyncStartedAt = Date.now();
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncHistoryId,
      fullSyncStartedAt,
    });
  }

  let pageToken: string | undefined = row.fullSyncPageToken ?? undefined;
  const connected = await connectedEmailsLower(ownerEmail);

  while (Date.now() < deadline) {
    const page = await gmailListThreads(accessToken, {
      q: "in:inbox",
      maxResults: FULL_SYNC_PAGE_SIZE,
      pageToken,
    });
    const ids: string[] = (page.threads ?? []).map((t: any) => t.id);
    if (ids.length > 0) {
      const rows = await hydrateThreads(
        accessToken,
        ids,
        ownerEmail,
        accountEmail,
        connected,
      );
      // Fenced immediately before the page's row writes: a claim lost to a
      // newer worker during the Gmail round trips above must not land here.
      await assertSyncClaimHeld(ownerEmail, accountEmail, claimId);
      await upsertInboxThreadRows(rows);
    }
    pageToken = page.nextPageToken;
    await patchProgress(ownerEmail, accountEmail, claimId, {
      fullSyncPageToken: pageToken ?? null,
    });

    if (!pageToken) {
      await assertSyncClaimHeld(ownerEmail, accountEmail, claimId);
      await markThreadsOutOfInboxBeforeSync(
        ownerEmail,
        accountEmail,
        fullSyncStartedAt!,
      );
      await patchProgress(ownerEmail, accountEmail, claimId, {
        historyId: fullSyncHistoryId,
        fullSyncPageToken: null,
        fullSyncHistoryId: null,
        fullSyncStartedAt: null,
        lastError: null,
        lastSyncedAt: Date.now(),
      });
      return { accountEmail, state: "ready", lastSyncedAt: Date.now() };
    }
  }

  // Budget exhausted mid-walk. The page token is already persisted above,
  // so the next call resumes from here.
  await patchProgress(ownerEmail, accountEmail, claimId, {
    lastError: null,
    lastSyncedAt: Date.now(),
  });
  return { accountEmail, state: "initial", lastSyncedAt: Date.now() };
}

async function runIncrementalSyncStep(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  row: SyncAccountRow,
  deadline: number,
  claimId: string,
): Promise<InboxSyncAccountStatus> {
  // Gmail's response `historyId` is the mailbox's *current* id, identical on
  // every page, so it is only a safe watermark once every page has been
  // consumed. When the budget runs out mid-way we persist the last processed
  // record's own id instead; records arrive in ascending order, so the next
  // call resumes exactly there rather than skipping the unread pages.
  let pageToken: string | undefined;
  let lastRecordId: string | null = null;
  let caughtUp = false;
  let currentHistoryId: string | null = null;
  do {
    let history: any;
    try {
      history = await gmailListHistory(accessToken, {
        startHistoryId: row.historyId!,
        maxResults: 500,
        pageToken,
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\(404\)/.test(message)) {
        // Gmail expired our watermark (commonly after >7 days without a
        // sync) — the only recovery is a fresh full sync. Fenced like every
        // other progress write in this claimed step.
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
        };
        return runFullSyncStep(
          ownerEmail,
          accountEmail,
          accessToken,
          freshRow,
          deadline,
          claimId,
        );
      }
      throw err;
    }

    const threadIds = new Set<string>();
    for (const record of history.history ?? []) {
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
      const connected = await connectedEmailsLower(ownerEmail);
      await hydrateAndApply(
        accessToken,
        [...threadIds],
        ownerEmail,
        accountEmail,
        connected,
        claimId,
      );
    }

    currentHistoryId =
      history.historyId != null ? String(history.historyId) : null;
    pageToken = history.nextPageToken || undefined;
    caughtUp = !pageToken;
    if (lastRecordId) {
      await patchProgress(ownerEmail, accountEmail, claimId, {
        historyId: lastRecordId,
      });
    }
  } while (pageToken && Date.now() < deadline);

  if (!caughtUp) {
    await patchProgress(ownerEmail, accountEmail, claimId, {
      lastError: null,
      lastSyncedAt: Date.now(),
    });
    return { accountEmail, state: "initial", lastSyncedAt: Date.now() };
  }

  await patchProgress(ownerEmail, accountEmail, claimId, {
    historyId: currentHistoryId ?? lastRecordId ?? row.historyId!,
    lastError: null,
    lastSyncedAt: Date.now(),
  });
  return { accountEmail, state: "ready", lastSyncedAt: Date.now() };
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
  // Fenced: a claim already lost to a newer worker must not stomp its
  // progress with this stale failure. If the fence no-ops, releaseSyncAccount
  // below (also fenced) no-ops too — nothing left to reconcile.
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

export async function syncInboxAccount(
  ownerEmail: string,
  accountEmail: string,
  opts?: { budgetMs?: number; force?: boolean },
): Promise<InboxSyncAccountStatus> {
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  await ensureSyncAccountRow(ownerEmail, accountEmail);
  const claim = await claimSyncAccount(ownerEmail, accountEmail, CLAIM_TTL_MS);
  if (!claim) {
    const current = (await readSyncAccounts(ownerEmail)).find(
      (r) => r.accountEmail === accountEmail.toLowerCase(),
    );
    return current
      ? statusFromRow(current)
      : { accountEmail, state: "initial", lastSyncedAt: null };
  }

  let row = claim.row;
  try {
    let client: { accessToken: string; email: string } | null;
    try {
      client = await getClientForConnectedAccount(ownerEmail, accountEmail);
    } catch (err) {
      return await failAccount(row, claim.claimId, err);
    }
    if (!client) {
      return await failAccount(
        row,
        claim.claimId,
        new Error("Google account not connected"),
      );
    }
    const accessToken = client.accessToken;

    // Labels: refresh + persist independently of thread sync, so a later
    // thread-sync failure below never loses a label refresh that already
    // succeeded.
    const labelsStale =
      opts?.force ||
      row.labelsUpdatedAt == null ||
      Date.now() - row.labelsUpdatedAt > LABELS_TTL_MS;
    if (labelsStale && Date.now() < deadline) {
      const result = await gmailListLabels(accessToken);
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
      await patchSyncAccount(ownerEmail, accountEmail, {
        labels,
        labelsUpdatedAt,
      });
      row = { ...row, labels, labelsUpdatedAt };
    }

    const accountStatus =
      row.historyId == null
        ? await runFullSyncStep(
            ownerEmail,
            accountEmail,
            accessToken,
            row,
            deadline,
            claim.claimId,
          )
        : await runIncrementalSyncStep(
            ownerEmail,
            accountEmail,
            accessToken,
            row,
            deadline,
            claim.claimId,
          );

    const dbStatus: SyncAccountRow["status"] =
      accountStatus.state === "error" || accountStatus.state === "needs_reauth"
        ? accountStatus.state
        : "idle";
    await releaseSyncAccount(ownerEmail, accountEmail, claim.claimId, dbStatus);
    invalidateListCacheForOwner(ownerEmail);
    return accountStatus;
  } catch (err) {
    if (err instanceof SyncClaimLostError) {
      // A newer worker already owns this account's row — this worker's
      // progress is stale by definition, so report "still syncing" and stop
      // quietly rather than calling failAccount (which would stomp the new
      // worker's row with an unfenced status write) or releaseSyncAccount
      // (a no-op anyway: our claimId no longer matches).
      return { accountEmail, state: "initial", lastSyncedAt: row.lastSyncedAt };
    }
    return await failAccount(row, claim.claimId, err);
  }
}

export async function ensureInboxFresh(
  ownerEmail: string,
  opts?: { accountEmails?: string[]; maxAgeMs?: number; budgetMs?: number },
): Promise<InboxSyncAccountStatus[]> {
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;

  // getConnectedAccounts is the single "which accounts exist" source: OAuth
  // accounts with Gmail scope, else the managed workspace grant's email (no
  // per-user OAuth row). Enumerating via listOAuthAccountsByOwner alone
  // would silently skip managed grants forever.
  const accounts = await getConnectedAccounts(ownerEmail);
  const requested = opts?.accountEmails?.length
    ? new Set(opts.accountEmails.map((e) => e.toLowerCase()))
    : null;
  const emails = accounts
    .map((email) => email.toLowerCase())
    .filter((email) => !requested || requested.has(email));

  const now = Date.now();
  return Promise.all(
    emails.map(async (accountEmail) => {
      const row = await ensureSyncAccountRow(ownerEmail, accountEmail);
      const fresh =
        row.lastSyncedAt != null && now - row.lastSyncedAt < maxAgeMs;
      if (fresh) return statusFromRow(row);
      try {
        // Accounts run concurrently and share nothing — each has its own
        // token bucket in google-api.ts, so there's no reason to serialize.
        return await syncInboxAccount(ownerEmail, accountEmail, { budgetMs });
      } catch (err) {
        // Belt-and-suspenders: syncInboxAccount already records failures on
        // the row and never throws, but a single account's bug must never
        // take the whole call down.
        return {
          accountEmail,
          state: "error" as const,
          lastSyncedAt: row.lastSyncedAt,
          error: boundedErrorMessage(err),
        };
      }
    }),
  );
}

export async function resetInboxSync(
  ownerEmail: string,
  accountEmail?: string,
): Promise<void> {
  if (accountEmail) {
    await resetSyncAccountProgress(ownerEmail, accountEmail);
    return;
  }
  // Same "which accounts exist" source as ensureInboxFresh — a managed
  // grant has no sync-account row until its first ensureInboxFresh call, so
  // resetting only existing readSyncAccounts rows would silently skip it.
  const emails = await getConnectedAccounts(ownerEmail);
  await Promise.all(
    emails.map((email) => resetSyncAccountProgress(ownerEmail, email)),
  );
}
