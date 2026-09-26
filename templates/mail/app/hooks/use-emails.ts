import { appApiPath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { archiveFailureToastMessage } from "@shared/archive-errors";
import { markdownPreviewSnippet } from "@shared/markdown";
import type {
  ComposeAttachment,
  EmailMessage,
  Label,
  SavedMailFilter,
  UserSettings,
} from "@shared/types";
import {
  keepPreviousData,
  type QueryClient,
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useAccountFilter } from "@/hooks/use-account-filter";
import {
  adjustInboxThreadUnreadOptimistic,
  cancelInboxThreadsQueries,
  clearInboxThreadRemoval,
  findInboxThreadIdByMessageId,
  forgetInboxMutation,
  INBOX_THREADS_QUERY_KEY,
  invalidateInboxThreads,
  markInboxThreadReadOptimistic,
  removeInboxThreadsOptimistic,
  retainInboxMutationTargets,
  restoreInboxThreadRemovals,
  settleInboxMutationIfObserved,
  snapshotInboxThreads,
  toggleInboxThreadsStarOptimistic,
  type InboxThreadRemovalSnapshot,
} from "@/hooks/use-inbox-threads";
import {
  gmailMutationQueue,
  type GmailMutationKind,
  type GmailMutationTarget,
} from "@/lib/gmail-mutation-queue";
import {
  beginProviderSnapshot,
  currentProviderSnapshotId,
} from "@/lib/provider-snapshot";
import { TAB_ID } from "@/lib/tab-id";
import {
  useThreadCache,
  ensureThread,
  invalidateCachedThread,
  getCachedThread,
  refreshCachedThread,
  setCachedThread,
  supersedeCachedThreadFetch,
} from "@/lib/thread-cache";
import { bodyToHtml } from "@/lib/utils";

import type { MoveEmailResult } from "../../actions/move-email";

const EMAIL_PAGE_SIZE = 25;
const EMAIL_PREFETCH_TIMEOUT_MS = 15_000;

function isAuthFailure(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403)
  );
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Request failed");
}

function assertActionSuccess<T>(result: T): T {
  if (
    typeof result === "string" &&
    (/^Error:/i.test(result) || /\bFailures:/i.test(result))
  ) {
    throw new Error(result);
  }
  return result;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export type ApiError = Error & { status?: number; retryAfterMs?: number };

export async function apiFetch<T>(
  url: string,
  options?: RequestInit & { onHeaders?: (headers: Headers) => void },
): Promise<T> {
  const { onHeaders, ...init } = options ?? {};
  const res = await fetch(appApiPath(url), {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    cache: "no-store",
    ...init,
  });
  throwIfApiFetchAborted(init.signal);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throwIfApiFetchAborted(init.signal);
    const error: ApiError = new Error(
      body?.error || `Request failed (${res.status})`,
    );
    error.status = res.status;
    // Gmail quota cooldowns are signaled via 429 + Retry-After (seconds);
    // the message itself is deliberately jargon-free, so callers need this.
    const retryAfter = Number(res.headers.get("Retry-After"));
    if (
      Number.isFinite(retryAfter) &&
      Number.isInteger(retryAfter) &&
      retryAfter > 0
    ) {
      error.retryAfterMs = retryAfter * 1000;
    }
    throw error;
  }
  onHeaders?.(res.headers);
  const data = await res.json();
  throwIfApiFetchAborted(init.signal);
  return data;
}

function throwIfApiFetchAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

export type AccountError = { email: string; error: string };

/** Parses the `X-Account-Errors` header the emails API sets when some
 * (not all) connected accounts failed to list — a 200 that silently
 * dropped part of the inbox otherwise looks identical to a complete one. */
export function parseAccountErrorsHeader(
  raw: string | null | undefined,
): AccountError[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const errors = parsed.filter(
      (entry): entry is AccountError =>
        !!entry &&
        typeof entry.email === "string" &&
        typeof entry.error === "string",
    );
    return errors.length > 0 ? errors : undefined;
  } catch (error) {
    // coercion-ok: this header is a best-effort diagnostic, not core data —
    // a malformed value must not break the actual email list. Logged (not
    // swallowed silently) so a genuinely broken header stays debuggable
    // instead of just reading as "no account errors".
    console.error("Failed to parse X-Account-Errors header", error);
    return undefined;
  }
}

export function fetchThreadMessages(
  threadId: string,
  accountEmail?: string,
): Promise<EmailMessage[]> {
  const params = new URLSearchParams();
  if (accountEmail) params.set("accountEmail", accountEmail);
  const suffix = params.toString() ? `?${params}` : "";
  return apiFetch(`/api/threads/${threadId}/messages${suffix}`);
}

let externalRefreshAt = 0;
let externalRefreshGeneration = 0;
const externalRefreshConsumers = new Map<string, number>();

export function markExternalEmailRefresh() {
  externalRefreshAt = Date.now();
  externalRefreshGeneration += 1;
}

export function consumeExternalEmailRefresh(
  scope = "default",
): number | undefined {
  const refreshAt = externalRefreshAt;
  if (!refreshAt) return undefined;
  if (Date.now() - refreshAt >= 5000) {
    externalRefreshAt = 0;
    externalRefreshConsumers.clear();
    return undefined;
  }
  if (externalRefreshConsumers.get(scope) === externalRefreshGeneration)
    return undefined;
  externalRefreshConsumers.set(scope, externalRefreshGeneration);
  return refreshAt;
}

function parseRecipients(value?: string): EmailMessage["to"] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((email) => ({ name: email, email }));
}

function makeTempId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveOptimisticSender(
  settings: UserSettings | undefined,
  accounts: Array<{ email: string; displayName?: string }>,
  accountEmail?: string,
): EmailMessage["from"] {
  const email =
    accountEmail ||
    settings?.email ||
    (accounts.length === 1 ? accounts[0]?.email : undefined) ||
    "";
  const account = accounts.find(
    (item) => item.email.toLowerCase() === email.toLowerCase(),
  );
  const name =
    account?.displayName ||
    settings?.name ||
    (email ? email : settings?.email || "Me");
  return { name, email };
}

const RECENT_SENT_DURATION = 2 * 60_000;
const recentSentMessages = new Map<
  string,
  { message: EmailMessage; timestamp: number }
>();

function messageThreadKey(message: EmailMessage): string {
  return message.threadId || message.id;
}

function rememberRecentSentEmail(message: EmailMessage) {
  recentSentMessages.set(message.id, { message, timestamp: Date.now() });
}

function replaceRecentSentEmail(tempId: string, message: EmailMessage) {
  recentSentMessages.delete(tempId);
  rememberRecentSentEmail(message);
}

function forgetRecentSentEmail(id: string) {
  recentSentMessages.delete(id);
}

function applyRecentSentEmails(
  emails: EmailMessage[],
  view: string,
  search?: string,
  label?: string,
): EmailMessage[] {
  if (search || label || (view !== "sent" && view !== "all")) return emails;
  if (recentSentMessages.size === 0) return emails;

  const now = Date.now();
  for (const [id, { timestamp }] of recentSentMessages) {
    if (now - timestamp > RECENT_SENT_DURATION) {
      recentSentMessages.delete(id);
    }
  }
  if (recentSentMessages.size === 0) return emails;

  // Index server rows by message id and thread key so we can drop optimistic
  // overlays once the server confirms the same message, or once the server
  // reports a fresher message in the same thread (reply arrived, user
  // archived/trashed, etc.).
  const serverIds = new Set(emails.map((message) => message.id));
  const newestByThread = new Map<string, number>();
  for (const message of emails) {
    const key = messageThreadKey(message);
    const ts = new Date(message.date).getTime();
    const existing = newestByThread.get(key);
    if (existing === undefined || ts > existing) {
      newestByThread.set(key, ts);
    }
  }

  const recent: EmailMessage[] = [];
  for (const [id, { message }] of recentSentMessages) {
    if (serverIds.has(message.id)) {
      recentSentMessages.delete(id);
      continue;
    }
    const threadKey = messageThreadKey(message);
    const serverNewest = newestByThread.get(threadKey);
    const optimisticTs = new Date(message.date).getTime();
    if (serverNewest !== undefined && serverNewest >= optimisticTs) {
      // Server has a row at least as fresh as our optimistic copy — let it
      // win so we don't mask a reply or archive that landed during the TTL.
      recentSentMessages.delete(id);
      continue;
    }
    recent.push(message);
  }

  if (recent.length === 0) return emails;

  const recentThreadKeys = new Set(recent.map(messageThreadKey));
  const recentIds = new Set(recent.map((message) => message.id));
  return [
    ...recent,
    ...emails.filter(
      (message) =>
        !recentIds.has(message.id) &&
        !recentThreadKeys.has(messageThreadKey(message)),
    ),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Delay cache invalidation for mutations with optimistic updates.
// Gmail's search index has eventual consistency — if we refetch immediately
// after archiving/trashing, the email may still appear in `in:inbox` results,
// undoing the optimistic removal. A short delay gives Gmail time to process.
function delayedInvalidate(
  qc: ReturnType<typeof useQueryClient>,
  keys: string[][],
  ms = 3000,
  onRefreshed?: () => void,
) {
  setTimeout(() => {
    void Promise.all(
      keys.map((key) => qc.invalidateQueries({ queryKey: key })),
    ).then(
      () => onRefreshed?.(),
      () => {},
    );
  }, ms);
}

// ─── Optimistic sent message ────────────────────────────────────────────────
// Used to show a reply in the thread immediately when the user clicks Send,
// before the 5-second undo delay fires the actual mutation.

export function useAddOptimisticReply() {
  const qc = useQueryClient();
  const { allAccounts } = useAccountFilter();

  return (data: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    replyToId?: string;
    replyToThreadId?: string;
    accountEmail?: string;
    attachments?: ComposeAttachment[];
  }): (() => void) | undefined => {
    const settings = qc.getQueryData<UserSettings>(["settings"]);
    const threadId = data.replyToThreadId || data.replyToId;
    if (!threadId) return;

    const optimisticMessage: EmailMessage = {
      id: makeTempId("sent"),
      threadId,
      from: resolveOptimisticSender(settings, allAccounts, data.accountEmail),
      to: parseRecipients(data.to),
      ...(data.cc ? { cc: parseRecipients(data.cc) } : {}),
      subject: data.subject || "(no subject)",
      snippet: markdownPreviewSnippet(data.body),
      body: data.body,
      bodyHtml: bodyToHtml(data.body),
      date: new Date().toISOString(),
      isRead: true,
      isStarred: false,
      isSent: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["sent"],
      ...(data.attachments && data.attachments.length > 0
        ? {
            attachments: data.attachments.map((att) => ({
              id: att.id,
              filename: att.originalName,
              mimeType: att.mimeType,
              size: att.size,
              url: att.url,
            })),
          }
        : {}),
      ...(data.accountEmail ? { accountEmail: data.accountEmail } : {}),
    };

    const prior = getCachedThread(threadId) ?? [];
    setCachedThread(
      threadId,
      [...prior, optimisticMessage].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      ),
    );

    // Return undo function that removes the optimistic message
    return () => {
      const current = getCachedThread(threadId) ?? [];
      setCachedThread(
        threadId,
        current.filter((m) => m.id !== optimisticMessage.id),
      );
    };
  };
}

// ─── Thread suppression ─────────────────────────────────────────────────────
// Gmail's search index has eventual consistency that can exceed the delay above.
// When we archive/trash/snooze/etc., we track the thread ID so that stale data
// from subsequent refetches is filtered out via `select` in useEmails.

type SuppressionAction =
  | "archive"
  | "trash"
  | "spam"
  | "block"
  | "mute"
  | "snooze"
  | "move";

// What the action removed the thread from — never where it might still be
// listed. Only the mutation knows this: archive and move drop INBOX plus the
// `removeLabel` they were handed and leave every other label attached, so
// describing the remaining locations instead hid threads from labels they
// still carry.
type SuppressionRemoval = {
  // Set when the action moved the thread into exactly one list (trash, spam).
  // It is gone from every other view and label.
  onlyIn?: string;
  // Views the thread left, plus the single label the action removed, if any.
  // Every other list — including labels it still carries — keeps showing it.
  views?: string[];
  label?: string;
};

type SuppressionEntry = {
  action: SuppressionAction;
  removed?: SuppressionRemoval;
};

// Keyed by thread, then by entry id: two mutations can hide the same thread at
// once, and each must be able to drop its own claim without revealing a thread
// the other still hides.
const suppressedThreads = new Map<string, Map<number, SuppressionEntry>>();
const settledSuppressionIds = new Map<string, Set<number>>();
const suppressionListeners = new Set<() => void>();
let suppressionVersion = 0;
let nextSuppressionId = 1;

function notifySuppressionListeners() {
  suppressionVersion += 1;
  for (const listener of suppressionListeners) listener();
}

function subscribeToSuppression(listener: () => void) {
  suppressionListeners.add(listener);
  return () => suppressionListeners.delete(listener);
}

/**
 * Suppress a thread from the lists the action removed it from. Returns the
 * entry id so a rollback can drop only this mutation's claim.
 */
export function suppressThread(
  threadId: string,
  action: SuppressionAction,
  removed?: SuppressionRemoval,
): number {
  const id = nextSuppressionId++;
  const entries = suppressedThreads.get(threadId) ?? new Map();
  entries.set(id, { action, removed });
  suppressedThreads.set(threadId, entries);
  notifySuppressionListeners();
  return id;
}

/** Drop one mutation's claim — used on mutation error rollback and undo. */
export function releaseSuppression(
  threadId: string,
  id: number | undefined,
): boolean {
  if (id === undefined) return false;
  const entries = suppressedThreads.get(threadId);
  const settled = settledSuppressionIds.get(threadId);
  const removedSettled = settled?.delete(id) ?? false;
  if (settled?.size === 0) settledSuppressionIds.delete(threadId);
  if (!entries?.delete(id)) {
    if (removedSettled) notifySuppressionListeners();
    return false;
  }
  const isLastClaim = entries.size === 0;
  if (isLastClaim) suppressedThreads.delete(threadId);
  notifySuppressionListeners();
  return isLastClaim;
}

/** Release a claim after a fresh provider response confirms its outcome. */
export function settleSuppression(threadId: string, id: number): boolean {
  const entries = suppressedThreads.get(threadId);
  if (!entries?.delete(id)) return false;
  if (entries.size === 0) suppressedThreads.delete(threadId);
  const settled = settledSuppressionIds.get(threadId) ?? new Set<number>();
  settled.add(id);
  settledSuppressionIds.set(threadId, settled);
  notifySuppressionListeners();
  return true;
}

/** Release only the supplied claims and report whether the thread is clear. */
export function releaseSuppressionClaims(
  threadId: string,
  ids: readonly number[],
): boolean {
  if (ids.length === 0) return false;
  const newestOwnId = Math.max(...ids);
  const hasNewerSettledClaim = [
    ...(settledSuppressionIds.get(threadId) ?? []),
  ].some((id) => id > newestOwnId);
  for (const id of ids) releaseSuppression(threadId, id);
  // Keep token ids stable after provider evidence retires a claim: an Undo
  // toast can outlive that evidence and still needs to send its inverse.
  return !suppressedThreads.has(threadId) && !hasNewerSettledClaim;
}

export type SuppressionClaimToken = {
  readonly ids: Map<string, number[]>;
  readonly inboxMutationIds: Map<string, string[]>;
};

function recordSuppressionClaim(
  token: SuppressionClaimToken | undefined,
  threadId: string,
  id: number,
) {
  if (!token) return;
  const ids = token.ids.get(threadId) ?? [];
  ids.push(id);
  token.ids.set(threadId, ids);
}

export function forgetSuppressionClaim(
  token: SuppressionClaimToken | undefined,
  threadId: string,
  id: number | undefined,
) {
  if (!token || id === undefined) return;
  const ids = token.ids.get(threadId);
  if (!ids) return;
  const remaining = ids.filter((value) => value !== id);
  if (remaining.length === 0) token.ids.delete(threadId);
  else token.ids.set(threadId, remaining);
}

function recordInboxMutationClaim(
  token: SuppressionClaimToken | undefined,
  threadId: string,
  id: string,
) {
  if (!token) return;
  const ids = token.inboxMutationIds.get(threadId) ?? [];
  ids.push(id);
  token.inboxMutationIds.set(threadId, ids);
}

function getInboxMutationIds(
  token: SuppressionClaimToken | undefined,
  threadId: string,
): readonly string[] {
  return token?.inboxMutationIds.get(threadId) ?? [];
}

/** Release the undo action's inbox journal synchronously, even when a newer
 * same-thread suppression means its provider inverse must not be sent. */
export function releaseOwnedInboxRemoval(
  qc: QueryClient,
  threadId: string,
  token: SuppressionClaimToken | undefined,
): InboxThreadRemovalSnapshot {
  const snapshot = clearInboxThreadRemoval(
    qc,
    threadId,
    getInboxMutationIds(token, threadId),
  );
  token?.inboxMutationIds.delete(threadId);
  return snapshot;
}

function useSuppressionClaims() {
  return {
    createSuppressionToken: (): SuppressionClaimToken => ({
      ids: new Map(),
      inboxMutationIds: new Map(),
    }),
    getSuppressionIds: (token: SuppressionClaimToken, threadId: string) =>
      token.ids.get(threadId) ?? [],
  };
}

function isSuppressedInView(
  threadId: string,
  view: string,
  label?: string,
): boolean {
  const entries = suppressedThreads.get(threadId);
  if (!entries) return false;
  let newest: SuppressionEntry | undefined;
  let newestId = 0;
  for (const [id, entry] of entries) {
    if (id > newestId) {
      newestId = id;
      newest = entry;
    }
  }
  if (!newest) return false;
  // Only the newest claim says where the thread now lives: an archive claim
  // must stop hiding it from Trash once a later trash put it there. Older
  // claims stay in the map purely so their own rollback stays scoped.
  const removed = newest.removed;
  if (!removed) return true;
  // Trash and spam leave exactly one list and nothing else, labels included.
  if (removed.onlyIn) return view !== removed.onlyIn;
  // A label tab is fetched as view "all" with that label, so only the label
  // the action actually removed may stop listing the thread; every label it
  // still carries keeps it.
  if (label) return removed.label === label;
  return removed.views?.includes(view) ?? false;
}

function suppressionAffectsView(
  removed: SuppressionRemoval | undefined,
  view: string,
  label: string | undefined,
): boolean {
  if (!removed) return true;
  // A final-location claim is only retired by evidence from that location.
  // Absence from every other list is expected and says nothing about whether
  // the destination list has caught up.
  if (removed.onlyIn) return false;
  return (
    removed.views?.includes(view) === true ||
    (label !== undefined && removed.label === label)
  );
}

/** Release a claim only after the same list has observed the provider state. */
function reconcileSuppressionEvidence(
  pages: readonly EmailsPage[],
  view: string,
  label?: string,
  search?: string,
) {
  // Search indexes have different consistency and pagination semantics from
  // the canonical list. They must not retire a claim for that list.
  if (search) return;
  const present = new Set(
    pages.flatMap((page) =>
      page.emails.map((email) => email.threadId || email.id),
    ),
  );
  // A missing row is not removal evidence until the loaded cursor reaches the
  // end. A reorder can move a still-present thread onto an unloaded page.
  const hasExhaustiveResult =
    pages.length > 0 && pages[pages.length - 1]?.nextPageToken === undefined;
  const releases: Array<[string, number]> = [];

  for (const [threadId, entries] of suppressedThreads) {
    const isPresent = present.has(threadId);
    for (const [id, entry] of entries) {
      // Every loaded page must come from a request that started after this
      // claim. This excludes placeholder/local cache data and out-of-order
      // responses while still allowing the first fresh response to settle a
      // mutation that Gmail has already reflected.
      if (
        pages.some(
          (page) =>
            typeof page.suppressionFence !== "number" ||
            page.suppressionFence < id,
        )
      ) {
        continue;
      }

      const observedFinalLocation = entry.removed?.onlyIn === view && isPresent;
      const observedRemoval =
        hasExhaustiveResult &&
        !isPresent &&
        suppressionAffectsView(entry.removed, view, label);
      if (observedFinalLocation || observedRemoval)
        releases.push([threadId, id]);
    }
  }

  for (const [threadId, id] of releases) settleSuppression(threadId, id);
}

export function filterSuppressedThreads(
  emails: EmailMessage[],
  view: string,
  label?: string,
): EmailMessage[] {
  if (suppressedThreads.size === 0) return emails;
  return emails.filter(
    (e) => !isSuppressedInView(e.threadId || e.id, view, label),
  );
}

// ─── Optimistic property overrides ──────────────────────────────────────────
// Gmail's eventual consistency means refetches can return stale read/star state,
// overwriting optimistic updates. We track local overrides here and apply them
// in the list projection so the UI never flickers back to stale state.

type OptimisticProperty = "isRead" | "isStarred";
type OptimisticOverride = {
  props: Partial<EmailMessage>;
  providerSnapshotFences: Partial<Record<OptimisticProperty, number>>;
};

const optimisticOverrides = new Map<string, OptimisticOverride>();
const optimisticOverrideListeners = new Set<() => void>();
let optimisticOverrideVersion = 0;

function notifyOptimisticOverrideListeners() {
  optimisticOverrideVersion += 1;
  for (const listener of optimisticOverrideListeners) listener();
}

function subscribeToOptimisticOverrides(listener: () => void) {
  optimisticOverrideListeners.add(listener);
  return () => optimisticOverrideListeners.delete(listener);
}

type BooleanMutationState = {
  version: number;
  confirmedVersion: number;
  confirmedState: boolean | undefined;
  pending: Map<number, boolean>;
};

function optimisticBooleanState(
  emailId: string,
  field: "isRead" | "isStarred",
  fallback: boolean | undefined,
): boolean | undefined {
  const value = optimisticOverrides.get(emailId)?.props[field];
  return typeof value === "boolean" ? value : fallback;
}

const starMutations = new Map<string, BooleanMutationState>();

function beginBooleanMutation(
  mutations: Map<string, BooleanMutationState>,
  emailId: string,
  currentState: boolean | undefined,
  nextState: boolean,
): number {
  const existing = mutations.get(emailId);
  const version = (existing?.version ?? 0) + 1;
  const mutation = existing ?? {
    version,
    confirmedVersion: 0,
    confirmedState: currentState,
    pending: new Map<number, boolean>(),
  };
  mutation.version = version;
  mutation.pending.set(version, nextState);
  mutations.set(emailId, mutation);
  return version;
}

function latestBooleanMutationState(
  mutation: BooleanMutationState,
): boolean | undefined {
  let latestVersion = mutation.confirmedVersion;
  let latestState = mutation.confirmedState;
  for (const [version, state] of mutation.pending) {
    if (version > latestVersion) {
      latestVersion = version;
      latestState = state;
    }
  }
  return latestState;
}

function confirmBooleanMutation(
  mutations: Map<string, BooleanMutationState>,
  emailId: string,
  version: number,
  state: boolean,
): boolean | undefined | null {
  const current = mutations.get(emailId);
  if (!current?.pending.delete(version)) return null;
  if (version > current.confirmedVersion) {
    current.confirmedVersion = version;
    current.confirmedState = state;
  }
  const resolved = latestBooleanMutationState(current);
  if (current.pending.size > 0) return resolved;
  mutations.delete(emailId);
  return resolved;
}

function rollbackBooleanMutation(
  mutations: Map<string, BooleanMutationState>,
  emailId: string,
  version: number,
): boolean | undefined | null {
  const current = mutations.get(emailId);
  if (!current?.pending.has(version)) return null;
  const latestVersion = Math.max(...current.pending.keys());
  current.pending.delete(version);
  if (version !== latestVersion) return null;
  if (current.pending.size === 0) {
    mutations.delete(emailId);
    return current.confirmedState;
  }
  const nextVersion = Math.max(...current.pending.keys());
  return nextVersion > current.confirmedVersion
    ? current.pending.get(nextVersion)
    : null;
}

const readMutationVersions = new Map<string, BooleanMutationState>();

export function beginReadMutation(
  emailId: string,
  currentState: boolean | undefined,
  isRead: boolean,
): number {
  return beginBooleanMutation(
    readMutationVersions,
    emailId,
    optimisticBooleanState(emailId, "isRead", currentState),
    isRead,
  );
}

export function confirmReadMutation(
  emailId: string,
  version: number,
  isRead: boolean,
): boolean | undefined | null {
  return confirmBooleanMutation(readMutationVersions, emailId, version, isRead);
}

export function rollbackReadMutation(
  emailId: string,
  version: number,
): boolean | undefined | null {
  return rollbackBooleanMutation(readMutationVersions, emailId, version);
}

function beginStarMutation(
  emailId: string,
  currentState: boolean | undefined,
  isStarred: boolean,
) {
  return beginBooleanMutation(
    starMutations,
    emailId,
    optimisticBooleanState(emailId, "isStarred", currentState),
    isStarred,
  );
}

function confirmStarMutation(
  emailId: string,
  version: number,
  isStarred: boolean,
) {
  return confirmBooleanMutation(starMutations, emailId, version, isStarred);
}

function rollbackStarMutation(emailId: string, version: number) {
  return rollbackBooleanMutation(starMutations, emailId, version);
}

function applyEmailBooleanMutationStates(
  states: Map<string, boolean | undefined | null>,
  field: "isRead" | "isStarred",
): Map<string, boolean> {
  const resolved = new Map<string, boolean>();
  for (const [emailId, state] of states) {
    if (state === undefined) {
      clearOptimisticOverrideProperty(emailId, field);
    } else if (state !== null) {
      setOptimisticOverride(emailId, { [field]: state });
      resolved.set(emailId, state);
    }
  }
  return resolved;
}

function applyReadMutationStates(
  states: Map<string, boolean | undefined | null>,
  threadId?: string,
) {
  const resolved = applyEmailBooleanMutationStates(states, "isRead");
  if (resolved.size === 0) return;
  if (!threadId) return;
  const thread = getCachedThread(threadId);
  if (!thread) return;
  setCachedThread(
    threadId,
    thread.map((message) =>
      resolved.has(message.id)
        ? { ...message, isRead: resolved.get(message.id)! }
        : message,
    ),
  );
}

function applyStarMutationStates(
  states: Map<string, boolean | undefined | null>,
  threadIdsByEmailId?: Readonly<Record<string, string>> | string,
) {
  const resolved = applyEmailBooleanMutationStates(states, "isStarred");
  if (resolved.size === 0 || !threadIdsByEmailId) return;
  const threadIds =
    typeof threadIdsByEmailId === "string"
      ? new Map([...resolved.keys()].map((id) => [id, threadIdsByEmailId]))
      : new Map(
          [...resolved.keys()]
            .map((id) => [id, threadIdsByEmailId[id]] as const)
            .filter((entry): entry is [string, string] => Boolean(entry[1])),
        );
  for (const threadId of new Set(threadIds.values())) {
    const thread = getCachedThread(threadId);
    if (!thread) continue;
    setCachedThread(
      threadId,
      thread.map((message) =>
        resolved.has(message.id)
          ? { ...message, isStarred: resolved.get(message.id)! }
          : message,
      ),
    );
  }
}

function refreshThreadAfterMutations(thread: {
  threadId: string;
  accountEmail?: string;
}) {
  void gmailMutationQueue
    .flush()
    .then(() => refreshCachedThread(thread.threadId, thread.accountEmail))
    .catch(() => {});
}

/** Set optimistic property overrides for an email (read, star, etc.) */
export function setOptimisticOverride(
  emailId: string,
  props: Partial<EmailMessage>,
  providerSnapshotFence = currentProviderSnapshotId(),
) {
  const existing = optimisticOverrides.get(emailId);
  optimisticOverrides.set(emailId, {
    props: { ...(existing?.props ?? {}), ...props },
    providerSnapshotFences: {
      ...(existing?.providerSnapshotFences ?? {}),
      ...(typeof props.isRead === "boolean"
        ? { isRead: providerSnapshotFence }
        : {}),
      ...(typeof props.isStarred === "boolean"
        ? { isStarred: providerSnapshotFence }
        : {}),
    },
  });
  notifyOptimisticOverrideListeners();
}

/** Clear optimistic overrides — used on mutation error rollback. */
export function clearOptimisticOverride(emailId: string) {
  if (optimisticOverrides.delete(emailId)) notifyOptimisticOverrideListeners();
}

function clearOptimisticOverrideProperty(
  emailId: string,
  property: keyof EmailMessage,
) {
  const existing = optimisticOverrides.get(emailId);
  if (!existing) return;
  const props = { ...existing.props };
  if (!(property in props)) return;
  delete props[property];
  const providerSnapshotFences = { ...existing.providerSnapshotFences };
  delete providerSnapshotFences[property as OptimisticProperty];
  if (Object.keys(props).length === 0) optimisticOverrides.delete(emailId);
  else optimisticOverrides.set(emailId, { props, providerSnapshotFences });
  notifyOptimisticOverrideListeners();
}

export function hasFreshOptimisticOverrideEvidence(
  observed: unknown,
  desired: unknown,
  observedProviderSnapshotId: number,
  providerSnapshotFence: number,
): boolean {
  return (
    observedProviderSnapshotId > providerSnapshotFence &&
    Object.is(observed, desired)
  );
}

export function reconcileOptimisticOverrides(
  pages: ReadonlyArray<{
    emails: EmailMessage[];
    providerSnapshotId?: number;
  }>,
) {
  if (optimisticOverrides.size === 0) return;
  const byId = new Map<
    string,
    { email: EmailMessage; providerSnapshotId: number }
  >();
  for (const page of pages) {
    const providerSnapshotId = page.providerSnapshotId ?? 0;
    for (const email of page.emails) {
      const existing = byId.get(email.id);
      if (!existing || providerSnapshotId > existing.providerSnapshotId) {
        byId.set(email.id, { email, providerSnapshotId });
      }
    }
  }
  let changed = false;

  for (const [emailId, entry] of optimisticOverrides) {
    const observed = byId.get(emailId);
    if (!observed) continue;
    const props = { ...entry.props };
    for (const property of Object.keys(props) as Array<keyof EmailMessage>) {
      if (
        (property !== "isRead" && property !== "isStarred") ||
        observed.providerSnapshotId <=
          (entry.providerSnapshotFences[property] ?? -1)
      ) {
        continue;
      }
      if (
        hasFreshOptimisticOverrideEvidence(
          observed.email[property],
          props[property],
          observed.providerSnapshotId,
          entry.providerSnapshotFences[property] ?? -1,
        )
      )
        delete props[property];
    }
    if (Object.keys(props).length === 0) {
      optimisticOverrides.delete(emailId);
      changed = true;
    } else if (Object.keys(props).length !== Object.keys(entry.props).length) {
      const providerSnapshotFences = { ...entry.providerSnapshotFences };
      for (const property of Object.keys(entry.props) as Array<
        keyof EmailMessage
      >) {
        if (!(property in props))
          delete providerSnapshotFences[property as OptimisticProperty];
      }
      optimisticOverrides.set(emailId, { props, providerSnapshotFences });
      changed = true;
    }
  }

  if (changed) notifyOptimisticOverrideListeners();
}

function applyOverrides(emails: EmailMessage[]): EmailMessage[] {
  if (optimisticOverrides.size === 0) return emails;
  let changed = false;
  const result = emails.map((e) => {
    const entry = optimisticOverrides.get(e.id);
    if (!entry) return e;
    changed = true;
    return { ...e, ...entry.props };
  });
  return changed ? result : emails;
}

// ─── Infinite query helpers ──────────────────────────────────────────────────
// The emails query uses useInfiniteQuery, so cached data is InfiniteData<EmailsPage>.
// These helpers let optimistic mutations map/filter emails within pages.

import type { InfiniteData } from "@tanstack/react-query";

export type InfiniteEmails = InfiniteData<EmailsPage, string | undefined>;

export function mapInfiniteEmails(
  old: InfiniteEmails | undefined,
  fn: (emails: EmailMessage[]) => EmailMessage[],
): InfiniteEmails | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page) => ({ ...page, emails: fn(page.emails) })),
  };
}

export function flattenInfiniteEmails(
  data: InfiniteEmails | undefined,
): EmailMessage[] {
  return data?.pages.flatMap((p) => p.emails) ?? [];
}

function isRecentSentListKey(key: readonly unknown[]): boolean {
  return (
    key[0] === "emails" &&
    (key[1] === "sent" || key[1] === "all") &&
    key[2] == null &&
    key[3] == null
  );
}

function getRecentSentListSnapshots(qc: ReturnType<typeof useQueryClient>) {
  return qc
    .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
    .filter(([key]) => isRecentSentListKey(key));
}

function upsertEmailInInfiniteList(
  old: InfiniteEmails | undefined,
  message: EmailMessage,
): InfiniteEmails | undefined {
  if (!old || old.pages.length === 0) return old;

  const threadKey = messageThreadKey(message);
  return {
    ...old,
    pages: old.pages.map((page, index) => {
      const emails = page.emails.filter(
        (existing) =>
          existing.id !== message.id &&
          messageThreadKey(existing) !== threadKey,
      );
      if (index !== 0) return { ...page, emails };
      return {
        ...page,
        emails: [message, ...emails].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
      };
    }),
  };
}

function replaceEmailInInfiniteList(
  old: InfiniteEmails | undefined,
  tempId: string,
  message: EmailMessage,
): InfiniteEmails | undefined {
  if (!old) return old;
  let replaced = false;
  const next = {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      emails: page.emails.map((existing) => {
        if (existing.id !== tempId) return existing;
        replaced = true;
        return message;
      }),
    })),
  };
  return replaced ? next : upsertEmailInInfiniteList(old, message);
}

// ─── Emails ──────────────────────────────────────────────────────────────────

export interface EmailsPage {
  emails: EmailMessage[];
  nextPageToken?: string;
  totalEstimate?: number;
  /** Present when some (not all) connected accounts failed this fetch. */
  accountErrors?: AccountError[];
  /** Client-only evidence that this page came from a provider request. */
  providerSnapshotId?: number;
  /** Highest suppression claim id that existed when the request started. */
  suppressionFence?: number;
}

export function keepLatestEmailPage(
  current: EmailsPage | undefined,
  incoming: EmailsPage,
): EmailsPage {
  return current &&
    (current.providerSnapshotId ?? 0) > (incoming.providerSnapshotId ?? 0)
    ? current
    : incoming;
}

// Retryable: transient upstream trouble (gateway) and network errors with no
// status at all. Never an auth failure — retrying a 401/403 just burns time
// before the UI can show the real "reconnect" state. Never a 429 either — that
// means the server's own Gmail quota breaker is already tripped, and it comes
// with its own Retry-After-driven countdown in the UI; an automatic retry here
// would only hit the still-active breaker.
function isRetryableEmailsError(error: unknown): boolean {
  if (isAuthFailure(error)) return false;
  const status = (error as { status?: unknown } | undefined)?.status;
  if (typeof status !== "number") return true;
  return status === 502 || status === 503 || status === 504;
}

type EmailQueryKey = readonly [
  "emails" | "email-prefetch",
  string,
  string | undefined,
  string | undefined,
];

function emailQueryOptions(
  queryClient: QueryClient,
  view: string,
  search?: string,
  label?: string,
  prefetchTimeoutMs?: number,
  queryKey: EmailQueryKey = ["emails", view, search, label],
) {
  return {
    queryKey,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: string | undefined;
      signal: AbortSignal;
    }) => {
      const providerSnapshotId = beginProviderSnapshot();
      const suppressionFence = nextSuppressionId - 1;
      const params = new URLSearchParams({ view });
      params.set("limit", String(EMAIL_PAGE_SIZE));
      if (search) params.set("q", search);
      if (label) params.set("label", label);
      if (pageParam) params.set("pageToken", pageParam);
      const forceRefreshAt = !pageParam
        ? consumeExternalEmailRefresh(
            JSON.stringify([view, search ?? null, label ?? null]),
          )
        : undefined;
      if (forceRefreshAt) {
        params.set("forceRefresh", String(forceRefreshAt));
      }
      const requestSignal = prefetchTimeoutMs
        ? AbortSignal.any([signal, AbortSignal.timeout(prefetchTimeoutMs)])
        : signal;
      let accountErrors: AccountError[] | undefined;
      const page = await apiFetch<EmailsPage>(`/api/emails?${params}`, {
        signal: requestSignal,
        onHeaders: (headers) => {
          accountErrors = parseAccountErrorsHeader(
            headers.get("X-Account-Errors"),
          );
        },
      });
      const incoming = {
        ...(accountErrors ? { ...page, accountErrors } : page),
        providerSnapshotId,
        suppressionFence,
      };
      const cached = queryClient.getQueryData<InfiniteEmails>(queryKey);
      const pageIndex = cached?.pageParams.findIndex(
        (value) => value === pageParam,
      );
      const current =
        pageIndex !== undefined && pageIndex >= 0
          ? cached?.pages[pageIndex]
          : undefined;
      return keepLatestEmailPage(current, incoming);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: EmailsPage) => lastPage.nextPageToken,
    staleTime: search ? 30_000 : 60_000,
    // A page reload starts from an empty cache, so one 429/502/503 on the
    // very first request used to leave the inbox looking permanently empty.
    // Bounded retry only for transient/network errors — never for auth.
    retry: (failureCount: number, error: unknown) =>
      failureCount < 2 && isRetryableEmailsError(error),
    retryDelay: (failureCount: number) => (failureCount === 0 ? 750 : 1500),
  };
}

export function prefetchEmails(
  queryClient: QueryClient,
  view: string,
  search?: string,
  label?: string,
) {
  const queryKey = ["emails", view, search, label] as const;
  const prefetchKey = ["email-prefetch", view, search, label] as const;
  // Keep timeout/cancellation-only prefetch requests off the foreground cache
  // key so a tab opened mid-prefetch always uses the normal query function.
  return queryClient
    .prefetchInfiniteQuery({
      ...emailQueryOptions(
        queryClient,
        view,
        search,
        label,
        EMAIL_PREFETCH_TIMEOUT_MS,
        prefetchKey,
      ),
    })
    .then(() => {
      const data = queryClient.getQueryData(prefetchKey);
      if (data && queryClient.getQueryData(queryKey) === undefined) {
        queryClient.setQueryData(queryKey, data);
      }
    })
    .finally(() => {
      queryClient.removeQueries({ queryKey: prefetchKey, exact: true });
    });
}

export function useEmails(
  view: string = "inbox",
  search?: string,
  label?: string,
  options?: { enabled?: boolean },
) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    ...emailQueryOptions(qc, view, search, label),
    // Keep the current list rendered while a search or tab query loads. Mail
    // navigation is client-side, so a new query must not look like a reload.
    placeholderData: keepPreviousData,
    // Gmail's per-user quota is tight. Keep pages modest and refetches
    // conservative; thread list hydration is quota-expensive even when batched.
    // Search queries get a short cache window so repeated renders/back
    // navigation do not re-hydrate the same expensive Gmail search immediately.
    // refetchOnWindowFocus stays off: with useInfiniteQuery it replays every
    // cached page (50+ Gmail calls each) on tab focus and trips the quota.
    // On error, back off (don't disable polling entirely). One transient
    // 429 / network blip used to stop auto-refresh forever — now we stretch
    // the interval based on consecutive failures, capped at 5 minutes, so the
    // UI keeps trying without hammering Gmail.
    refetchInterval: (query: {
      state: { status: string; fetchFailureCount: number; error: unknown };
    }) => {
      if (search) return false;
      if (isAuthFailure(query.state.error)) return false;
      const base = 2 * 60_000;
      if (query.state.status === "error") {
        return Math.min(base * (1 + query.state.fetchFailureCount), 5 * 60_000);
      }
      return base;
    },
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
  const currentSuppressionVersion = useSyncExternalStore(
    subscribeToSuppression,
    () => suppressionVersion,
    () => suppressionVersion,
  );
  const currentOptimisticOverrideVersion = useSyncExternalStore(
    subscribeToOptimisticOverrides,
    () => optimisticOverrideVersion,
    () => optimisticOverrideVersion,
  );
  const lastProviderSnapshotId = useRef(0);
  const providerSnapshotId =
    q.data?.pages.reduce(
      (latest, page: EmailsPage) =>
        Math.max(latest, page.providerSnapshotId ?? 0),
      0,
    ) ?? 0;

  useEffect(() => {
    if (
      !q.data ||
      q.isPlaceholderData ||
      providerSnapshotId === 0 ||
      providerSnapshotId === lastProviderSnapshotId.current
    )
      return;
    lastProviderSnapshotId.current = providerSnapshotId;
    reconcileSuppressionEvidence(q.data.pages, view, label, search);
    if (!search) reconcileOptimisticOverrides(q.data.pages);
  }, [q.data, q.isPlaceholderData, view, search, label, providerSnapshotId]);

  const data = useMemo(() => {
    if (!q.data) return undefined;
    const all = q.data.pages.flatMap((p: EmailsPage) => p.emails);
    const visible = applyOverrides(filterSuppressedThreads(all, view, label));
    return applyRecentSentEmails(visible, view, search, label);
  }, [
    q.data,
    view,
    search,
    label,
    currentSuppressionVersion,
    currentOptimisticOverrideVersion,
  ]);

  // Union account errors across every loaded page, de-duped by account — a
  // partial failure on page 2 must not get silently dropped just because
  // page 1 fetched clean.
  const accountErrors = useMemo(() => {
    if (!q.data || q.isPlaceholderData) return undefined;
    const byEmail = new Map<string, AccountError>();
    for (const page of q.data.pages as EmailsPage[]) {
      for (const err of page.accountErrors ?? []) byEmail.set(err.email, err);
    }
    return byEmail.size > 0 ? [...byEmail.values()] : undefined;
  }, [q.data, q.isPlaceholderData]);

  // Placeholder InfiniteData includes the previous query's page token. Keep
  // pagination disabled until the new query owns the pages.
  const canPaginate = !q.isPlaceholderData;
  const hasCurrentQueryData = Boolean(q.data) && !q.isPlaceholderData;

  return {
    data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isRefetching: q.isRefetching,
    // Keep stale data visible when a background refetch fails (usually Gmail
    // quota cooldown). Showing the full error state while data exists makes
    // the inbox appear to flash/reload even though the old page is usable.
    isError: q.isError && !hasCurrentQueryData,
    error: q.isError && !hasCurrentQueryData ? toError(q.error) : null,
    totalEstimate: q.data?.pages[0]?.totalEstimate,
    accountErrors,
    refetch: q.refetch,
    hasNextPage: canPaginate && q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: canPaginate && q.isFetchingNextPage,
    isFetchNextPageError: canPaginate && q.isFetchNextPageError,
  };
}

export function useEmail(
  id: string | undefined,
  accountEmail: string | undefined,
) {
  return useQuery<EmailMessage>({
    queryKey: ["email", accountEmail, id],
    queryFn: () =>
      callAction<EmailMessage>(
        "get-email",
        { accountEmail: accountEmail!, id: id! },
        { method: "GET" },
      ).then(assertActionSuccess),
    enabled: !!id && !!accountEmail,
    retry: (failureCount, error) => !isAuthFailure(error) && failureCount < 1,
  });
}

export function useThreadMessages(threadId: string | undefined) {
  const qc = useQueryClient();
  // Synchronous read from the plain-Map thread cache. Placeholder comes from
  // the list cache so the first frame of the detail view has at least the
  // latest message.
  const placeholder = (() => {
    if (!threadId) return undefined;
    const queries = qc.getQueriesData<InfiniteEmails>({
      queryKey: ["emails"],
    });
    for (const [, data] of queries) {
      const flat = flattenInfiniteEmails(data);
      for (const email of flat) {
        if ((email.threadId || email.id) === threadId) return [email];
      }
    }
    return undefined;
  })();
  const { messages, isFromCache, isLoading, providerSnapshotId } =
    useThreadCache(threadId, placeholder, placeholder?.[0]?.accountEmail);
  // Thread refreshes can return an older Gmail read/star value after the
  // mutation has already completed. Subscribe here as well as in useEmails so
  // the detail view applies the same durable override while that fetch catches
  // up.
  useSyncExternalStore(
    subscribeToOptimisticOverrides,
    () => optimisticOverrideVersion,
    () => optimisticOverrideVersion,
  );
  useEffect(() => {
    if (!messages || !isFromCache || providerSnapshotId <= 0) return;
    reconcileOptimisticOverrides([{ emails: messages, providerSnapshotId }]);
  }, [isFromCache, messages, providerSnapshotId]);
  return {
    data: messages ? applyOverrides(messages) : messages,
    isLoading: isLoading && !messages,
    isFetching: isLoading,
    isError: false,
    error: null,
    refetch: () => {
      if (threadId) {
        invalidateCachedThread(threadId);
        return ensureThread(threadId, placeholder?.[0]?.accountEmail);
      }
      return Promise.resolve(undefined);
    },
    // true when the returned messages are the final server payload (not a
    // placeholder). Callers can use this to show "loading full body" hints.
    isFromCache,
  };
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      isRead,
      accountEmail,
      threadId,
    }: {
      id: string;
      isRead: boolean;
      accountEmail?: string;
      threadId?: string;
    }) =>
      // Buffer + batch via Gmail messages.batchModify so rapid open/mark-read
      // (and e-e-e archive) stay snappy without burning quota per keypress.
      gmailMutationQueue.enqueue("mark-read", {
        id,
        threadId,
        accountEmail,
        flag: isRead,
      }),
    onMutate: async ({ id, isRead, accountEmail, threadId }) => {
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((email) => email.id === id);
      const resolvedThreadId =
        threadId ||
        target?.threadId ||
        findInboxThreadIdByMessageId(qc, id) ||
        target?.id;
      const previousThread = resolvedThreadId
        ? getCachedThread(resolvedThreadId)
        : undefined;
      const previousReadState =
        previousThread?.find((message) => message.id === id)?.isRead ??
        target?.isRead;
      const mutationVersion = beginReadMutation(
        id,
        previousReadState ?? target?.isRead,
        isRead,
      );
      setOptimisticOverride(id, { isRead });
      // Message-scoped: this only touches one message, so the row's unread
      // count must move by ±1, not snap the whole thread to read/unread —
      // see adjustInboxThreadUnreadOptimistic's doc.
      const inboxMutationId =
        previousReadState !== undefined && previousReadState !== isRead
          ? adjustInboxThreadUnreadOptimistic(
              qc,
              resolvedThreadId ?? id,
              isRead ? -1 : 1,
            )
          : undefined;
      const restartThread = resolvedThreadId
        ? supersedeCachedThreadFetch(resolvedThreadId)
        : false;
      if (resolvedThreadId) {
        if (previousThread) {
          setCachedThread(
            resolvedThreadId,
            previousThread.map((message) =>
              message.id === id ? { ...message, isRead } : message,
            ),
          );
        }
      }
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return {
        mutationVersion,
        threadId: resolvedThreadId,
        inboxMutationId,
        refreshThread:
          resolvedThreadId && restartThread
            ? { threadId: resolvedThreadId, accountEmail }
            : undefined,
      };
    },
    onSuccess: (_data, { id, isRead }, context) => {
      if (!context) return;
      applyReadMutationStates(
        new Map([
          [id, confirmReadMutation(id, context.mutationVersion, isRead)],
        ]),
        context.threadId,
      );
    },
    onError: (err, { id }, context) => {
      const confirmedState = context
        ? rollbackReadMutation(id, context.mutationVersion)
        : null;
      applyReadMutationStates(
        new Map([[id, confirmedState]]),
        context?.threadId,
      );
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(toError(err).message);
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context?.refreshThread) {
        refreshThreadAfterMutations(context.refreshThread);
      }
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      );
    },
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: ({
      threadId,
      accountEmail,
    }: {
      threadId: string;
      accountEmail?: string;
    }) =>
      callAction("mark-thread-read", { threadId, accountEmail }).then(
        assertActionSuccess,
      ),
    retry: (failureCount, error) =>
      failureCount < 1 && markThreadReadRetryAfterMs(error) !== undefined,
    retryDelay: (_failureCount, error) =>
      markThreadReadRetryAfterMs(error) ?? 0,
    onMutate: async ({ threadId, accountEmail }) => {
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const allEmails =
        previous.flatMap(([, data]) => flattenInfiniteEmails(data)) ?? [];
      const previousThread = getCachedThread(threadId);
      const unreadIds = new Set(
        [...allEmails, ...(previousThread ?? [])]
          .filter(
            (email) =>
              (email.threadId || email.id) === threadId && !email.isRead,
          )
          .map((email) => email.id),
      );
      const mutations = [...unreadIds].map((id) => ({
        id,
        version: beginReadMutation(id, false, true),
      }));
      const restartThread = supersedeCachedThreadFetch(threadId);
      // Set overrides so refetches don't revert read state
      for (const id of unreadIds) {
        setOptimisticOverride(id, { isRead: true });
      }
      const inboxMutationId = markInboxThreadReadOptimistic(
        qc,
        new Set([threadId]),
        true,
      );
      if (previousThread) {
        setCachedThread(
          threadId,
          previousThread.map((message) => ({ ...message, isRead: true })),
        );
      }
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return {
        mutations,
        inboxMutationId,
        refreshThread: restartThread
          ? {
              threadId,
              accountEmail:
                accountEmail ??
                allEmails.find(
                  (email) => (email.threadId || email.id) === threadId,
                )?.accountEmail,
            }
          : undefined,
      };
    },
    onSuccess: (_data, { threadId }, context) => {
      const confirmed = new Map<string, boolean | undefined | null>();
      for (const mutation of context?.mutations ?? []) {
        confirmed.set(
          mutation.id,
          confirmReadMutation(mutation.id, mutation.version, true),
        );
      }
      applyReadMutationStates(confirmed, threadId);
    },
    onError: (err, { threadId }, context) => {
      const rollback = new Map<string, boolean | undefined | null>();
      for (const mutation of context?.mutations ?? []) {
        rollback.set(
          mutation.id,
          rollbackReadMutation(mutation.id, mutation.version),
        );
      }
      applyReadMutationStates(rollback, threadId);
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(
        markThreadReadRetryAfterMs(err) !== undefined
          ? t("mail.error.rateLimitDescription")
          : toError(err).message,
      );
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context?.refreshThread) {
        refreshThreadAfterMutations(context.refreshThread);
      }
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      );
    },
  });
}

export function markThreadReadRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const details = error as {
    status?: unknown;
    errorCode?: unknown;
    retryAfterMs?: unknown;
  };
  if (
    details.status !== 429 ||
    details.errorCode !== "gmail_quota_cooldown" ||
    typeof details.retryAfterMs !== "number" ||
    !Number.isInteger(details.retryAfterMs) ||
    details.retryAfterMs <= 0
  ) {
    return undefined;
  }
  return Math.min(details.retryAfterMs, 300_000);
}

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      isStarred,
      accountEmail,
      threadId,
    }: {
      id: string;
      isStarred: boolean;
      accountEmail?: string;
      threadId?: string;
    }) =>
      gmailMutationQueue.enqueue("star", {
        id,
        threadId,
        accountEmail,
        flag: isStarred,
      }),
    onMutate: async ({ id, isStarred, threadId }) => {
      const target = qc
        .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const resolvedThreadId =
        threadId ||
        target?.threadId ||
        findInboxThreadIdByMessageId(qc, id) ||
        target?.id;
      const previousThread = resolvedThreadId
        ? getCachedThread(resolvedThreadId)
        : undefined;
      const mutationVersion = beginStarMutation(
        id,
        target?.isStarred,
        isStarred,
      );
      setOptimisticOverride(id, { isStarred });
      const inboxSnapshot = snapshotInboxThreads(qc);
      const threadKey = resolvedThreadId ?? id;
      let inboxMutationId: string | undefined;
      if (isStarred) {
        // Starring one message stars the thread row — correct as-is.
        inboxMutationId = toggleInboxThreadsStarOptimistic(
          qc,
          new Set([threadKey]),
          true,
        );
      } else if (previousThread) {
        // Only clear the row's star if no OTHER message in the thread is
        // still starred — the server never removes STARRED at message scope
        // (see applyLocalLabelDelta), so neither should we.
        const otherStarred = previousThread.some(
          (message) => message.id !== id && message.isStarred,
        );
        if (!otherStarred) {
          inboxMutationId = toggleInboxThreadsStarOptimistic(
            qc,
            new Set([threadKey]),
            false,
          );
        }
      } else if (!isStarred) {
        // Thread not cached — only safe to clear when we can see from the
        // inbox row itself that it's a single-message thread.
        const row = inboxSnapshot
          .flatMap(([, data]) => data?.items ?? [])
          .find((item) => (item.threadId || item.id) === threadKey);
        if ((row?.messageCount ?? 1) === 1) {
          inboxMutationId = toggleInboxThreadsStarOptimistic(
            qc,
            new Set([threadKey]),
            false,
          );
        }
      }
      if (resolvedThreadId && previousThread) {
        setCachedThread(
          resolvedThreadId,
          previousThread.map((message) =>
            message.id === id ? { ...message, isStarred } : message,
          ),
        );
      }
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return {
        previousThread,
        threadId: resolvedThreadId,
        inboxSnapshot,
        inboxMutationId,
        mutationVersion,
      };
    },
    onSuccess: (_data, { id, isStarred }, context) => {
      if (!context) return;
      applyStarMutationStates(
        new Map([
          [id, confirmStarMutation(id, context.mutationVersion, isStarred)],
        ]),
        context.threadId,
      );
    },
    onError: (err, { id }, context) => {
      const state = context
        ? rollbackStarMutation(id, context.mutationVersion)
        : null;
      applyStarMutationStates(new Map([[id, state]]), context?.threadId);
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(toError(err).message);
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
}

interface ArchiveEmailVars {
  id: string;
  accountEmail?: string;
  removeLabel?: string;
  threadId?: string;
  suppressionToken?: SuppressionClaimToken;
}

export function useArchiveEmail() {
  const qc = useQueryClient();
  const t = useT();
  const { createSuppressionToken, getSuppressionIds } = useSuppressionClaims();
  const mutation = useMutation({
    mutationFn: ({
      id,
      accountEmail,
      removeLabel,
      threadId,
    }: ArchiveEmailVars) =>
      gmailMutationQueue.enqueue("archive", {
        id,
        accountEmail,
        removeLabel,
        threadId,
      }),
    onMutate: async ({
      id,
      removeLabel,
      threadId: hintedThreadId,
      suppressionToken,
    }: ArchiveEmailVars) => {
      const target = qc
        .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const threadId =
        hintedThreadId ||
        target?.threadId ||
        findInboxThreadIdByMessageId(qc, id) ||
        id;
      const suppressionId = suppressThread(threadId, "archive", {
        views: ["inbox", "unread"],
        label: removeLabel,
      });
      recordSuppressionClaim(suppressionToken, threadId, suppressionId);
      invalidateCachedThread(threadId);
      const inboxMutationId = removeInboxThreadsOptimistic(
        qc,
        new Set([threadId]),
      );
      recordInboxMutationClaim(suppressionToken, threadId, inboxMutationId);
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { threadId, suppressionId, inboxMutationId };
    },
    onError: (err, variables, context) => {
      if (context?.threadId) {
        forgetSuppressionClaim(
          variables.suppressionToken,
          context.threadId,
          context.suppressionId,
        );
        releaseSuppression(context.threadId, context.suppressionId);
      }
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(
        archiveFailureToastMessage(err, t("mail.toasts.archiveFailed")),
      );
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
  return { ...mutation, createSuppressionToken, getSuppressionIds };
}

export interface EmailAccountRef {
  id: string;
  accountEmail?: string;
  threadId?: string;
  suppressionToken?: SuppressionClaimToken;
  inboxRemovalSnapshot?: InboxThreadRemovalSnapshot;
}

export function useUnarchiveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountEmail }: EmailAccountRef) => {
      // Undo can land while the archive is already flushing. Wait for that
      // result before sending the inverse so the archive cannot win last.
      return gmailMutationQueue
        .cancelOrWait("archive", id)
        .then((archiveOutcome) => {
          if (archiveOutcome === "cancelled" || archiveOutcome === "failed") {
            return "archive-not-applied";
          }
          return callAction("unarchive-email", { id, accountEmail }).then(
            assertActionSuccess,
          );
        });
    },
    onMutate: ({
      id,
      threadId: hintedThreadId,
      suppressionToken,
      inboxRemovalSnapshot: suppliedInboxRemovalSnapshot,
    }: EmailAccountRef) => {
      const threadId = hintedThreadId || findInboxThreadIdByMessageId(qc, id);
      const inboxRemovalSnapshot =
        suppliedInboxRemovalSnapshot ??
        (threadId
          ? releaseOwnedInboxRemoval(qc, threadId, suppressionToken)
          : []);
      return { inboxRemovalSnapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.inboxRemovalSnapshot?.length) {
        restoreInboxThreadRemovals(qc, context.inboxRemovalSnapshot);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emails"] });
      qc.invalidateQueries({ queryKey: LABELS_QUERY_KEY });
      invalidateInboxThreads(qc);
    },
  });
}

export function useUntrashEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountEmail }: EmailAccountRef) =>
      gmailMutationQueue.cancelOrWait("trash", id).then((trashOutcome) => {
        if (trashOutcome === "cancelled" || trashOutcome === "failed") {
          return "trash-not-applied";
        }
        return callAction("untrash-email", { id, accountEmail }).then(
          assertActionSuccess,
        );
      }),
    onMutate: ({
      id,
      threadId: hintedThreadId,
      suppressionToken,
      inboxRemovalSnapshot: suppliedInboxRemovalSnapshot,
    }: EmailAccountRef) => {
      const threadId = hintedThreadId || findInboxThreadIdByMessageId(qc, id);
      const inboxRemovalSnapshot =
        suppliedInboxRemovalSnapshot ??
        (threadId
          ? releaseOwnedInboxRemoval(qc, threadId, suppressionToken)
          : []);
      return { inboxRemovalSnapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.inboxRemovalSnapshot?.length) {
        restoreInboxThreadRemovals(qc, context.inboxRemovalSnapshot);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emails"] });
      qc.invalidateQueries({ queryKey: LABELS_QUERY_KEY });
      invalidateInboxThreads(qc);
    },
  });
}

export function useTrashEmail() {
  const qc = useQueryClient();
  const { createSuppressionToken, getSuppressionIds } = useSuppressionClaims();
  const mutation = useMutation({
    mutationFn: ({ id, accountEmail, threadId }: EmailAccountRef) =>
      gmailMutationQueue.enqueue("trash", { id, accountEmail, threadId }),
    onMutate: async ({
      id,
      threadId: hintedThreadId,
      suppressionToken,
    }: EmailAccountRef) => {
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      // Find the email across all cached queries to get its threadId
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const threadId =
        hintedThreadId ||
        target?.threadId ||
        findInboxThreadIdByMessageId(qc, id) ||
        id;
      const suppressionId = suppressThread(threadId, "trash", {
        onlyIn: "trash",
      });
      recordSuppressionClaim(suppressionToken, threadId, suppressionId);
      const inboxMutationId = removeInboxThreadsOptimistic(
        qc,
        new Set([threadId]),
      );
      recordInboxMutationClaim(suppressionToken, threadId, inboxMutationId);
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { threadId, suppressionId, inboxMutationId };
    },
    onError: (err, variables, context) => {
      if (context?.threadId) {
        forgetSuppressionClaim(
          variables.suppressionToken,
          context.threadId,
          context.suppressionId,
        );
        releaseSuppression(context.threadId, context.suppressionId);
      }
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(toError(err).message);
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
  return { ...mutation, createSuppressionToken, getSuppressionIds };
}

export interface BulkEmailTarget {
  id: string;
  threadId?: string;
  accountEmail?: string;
}

class BulkGmailMutationFailure extends Error {
  constructor(
    readonly failedIds: string[],
    readonly succeededIds: string[],
    cause: unknown,
  ) {
    super(
      `${failedIds.length}/${failedIds.length + succeededIds.length} Gmail mutations failed`,
    );
    Object.defineProperty(this, "cause", {
      value: cause,
      configurable: true,
    });
    this.name = "BulkGmailMutationFailure";
  }
}

async function enqueueBulkGmailMutation(
  kind: GmailMutationKind,
  targets: BulkEmailTarget[],
  toMutationTarget: (target: BulkEmailTarget) => GmailMutationTarget,
): Promise<void> {
  const results = await Promise.allSettled(
    targets.map((target) =>
      gmailMutationQueue.enqueue(kind, toMutationTarget(target)),
    ),
  );
  const failedIds = targets.flatMap((target, index) =>
    results[index]?.status === "rejected" ? [target.id] : [],
  );
  if (failedIds.length > 0) {
    const succeededIds = targets.flatMap((target, index) =>
      results[index]?.status === "fulfilled" ? [target.id] : [],
    );
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw new BulkGmailMutationFailure(
      failedIds,
      succeededIds,
      firstFailure?.reason,
    );
  }
}

function resolveBulkThreadIds(
  qc: QueryClient,
  targets: BulkEmailTarget[],
): Record<string, string> {
  return Object.fromEntries(
    targets.map((target) => [
      target.id,
      target.threadId ||
        findInboxThreadIdByMessageId(qc, target.id) ||
        target.id,
    ]),
  );
}

function reconcilePartialInboxMutation(
  qc: QueryClient,
  context: {
    inboxMutationId?: string;
  },
  succeededThreadIds: ReadonlySet<string>,
) {
  if (!context.inboxMutationId) return;
  context.inboxMutationId = retainInboxMutationTargets(
    qc,
    context.inboxMutationId,
    succeededThreadIds,
  );
}

interface BulkArchiveVars {
  targets: BulkEmailTarget[];
  removeLabel?: string;
  suppressionToken?: SuppressionClaimToken;
}

/**
 * Bulk archive: one action call carrying every selected id (server batches
 * into one Gmail call per account) plus one optimistic cache update, instead
 * of N mutate() calls each racing their own cache write/rollback.
 */
export function useBulkArchiveEmails() {
  const qc = useQueryClient();
  const t = useT();
  const { createSuppressionToken, getSuppressionIds } = useSuppressionClaims();
  const mutation = useMutation({
    mutationFn: ({ targets, removeLabel }: BulkArchiveVars) =>
      enqueueBulkGmailMutation("archive", targets, (target) => ({
        ...target,
        removeLabel,
      })).then(() => `Queued archive for ${targets.length} email(s)`),
    onMutate: async ({
      targets,
      removeLabel,
      suppressionToken,
    }: BulkArchiveVars) => {
      const allEmails = qc
        .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
        .flatMap(([, data]) => flattenInfiniteEmails(data));
      const threadIdsByEmailId: Record<string, string> = {};
      const threadIds = targets.map((target) => {
        const found = allEmails.find((e) => e.id === target.id);
        const threadId =
          target.threadId ||
          found?.threadId ||
          findInboxThreadIdByMessageId(qc, target.id) ||
          target.id;
        threadIdsByEmailId[target.id] = threadId;
        return threadId;
      });
      const threadIdSet = new Set(threadIds);
      const suppressionIds: Record<string, number> = {};
      for (const threadId of threadIdSet) {
        suppressionIds[threadId] = suppressThread(threadId, "archive", {
          views: ["inbox", "unread"],
          label: removeLabel,
        });
        recordSuppressionClaim(
          suppressionToken,
          threadId,
          suppressionIds[threadId],
        );
      }
      for (const threadId of threadIdSet) invalidateCachedThread(threadId);
      const inboxMutationId = removeInboxThreadsOptimistic(qc, threadIdSet);
      for (const threadId of threadIdSet) {
        recordInboxMutationClaim(suppressionToken, threadId, inboxMutationId);
      }
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return {
        threadIds: [...threadIdSet],
        threadIdsByEmailId,
        suppressionIds,
        inboxMutationId,
      };
    },
    onError: (err, variables, context) => {
      if (err instanceof BulkGmailMutationFailure && context) {
        const failedThreadIds = new Set(
          err.failedIds.map((id) => context.threadIdsByEmailId[id] || id),
        );
        const succeededThreadIds = new Set(
          err.succeededIds.map((id) => context.threadIdsByEmailId[id] || id),
        );
        for (const threadId of failedThreadIds) {
          forgetSuppressionClaim(
            variables.suppressionToken,
            threadId,
            context.suppressionIds[threadId],
          );
          releaseSuppression(threadId, context.suppressionIds[threadId]);
        }
        reconcilePartialInboxMutation(qc, context, succeededThreadIds);
        toast.error(
          archiveFailureToastMessage(err, t("mail.toasts.archiveFailed")),
        );
        return;
      }
      for (const threadId of context?.threadIds ?? []) {
        forgetSuppressionClaim(
          variables.suppressionToken,
          threadId,
          context?.suppressionIds[threadId],
        );
        releaseSuppression(threadId, context?.suppressionIds[threadId]);
      }
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(
        archiveFailureToastMessage(err, t("mail.toasts.archiveFailed")),
      );
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
  return { ...mutation, createSuppressionToken, getSuppressionIds };
}

/** Bulk trash: one action call with server-side bounded Gmail work. */
interface BulkTrashVars {
  targets: BulkEmailTarget[];
  suppressionToken?: SuppressionClaimToken;
}

export function useBulkTrashEmails() {
  const qc = useQueryClient();
  const { createSuppressionToken, getSuppressionIds } = useSuppressionClaims();
  const mutation = useMutation({
    mutationFn: ({ targets }: BulkTrashVars) =>
      enqueueBulkGmailMutation("trash", targets, (target) => target),
    onMutate: async ({ targets, suppressionToken }: BulkTrashVars) => {
      const allEmails = qc
        .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
        .flatMap(([, data]) => flattenInfiniteEmails(data));
      const threadIdsByEmailId: Record<string, string> = {};
      const threadIds = targets.map((target) => {
        const found = allEmails.find((e) => e.id === target.id);
        const threadId =
          target.threadId ||
          found?.threadId ||
          findInboxThreadIdByMessageId(qc, target.id) ||
          target.id;
        threadIdsByEmailId[target.id] = threadId;
        return threadId;
      });
      const threadIdSet = new Set(threadIds);
      const suppressionIds: Record<string, number> = {};
      for (const threadId of threadIdSet) {
        suppressionIds[threadId] = suppressThread(threadId, "trash", {
          onlyIn: "trash",
        });
        recordSuppressionClaim(
          suppressionToken,
          threadId,
          suppressionIds[threadId],
        );
      }
      const inboxMutationId = removeInboxThreadsOptimistic(qc, threadIdSet);
      for (const threadId of threadIdSet) {
        recordInboxMutationClaim(suppressionToken, threadId, inboxMutationId);
      }
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return {
        threadIds: [...threadIdSet],
        threadIdsByEmailId,
        suppressionIds,
        inboxMutationId,
      };
    },
    onError: (err, variables, context) => {
      if (err instanceof BulkGmailMutationFailure && context) {
        const failedThreadIds = new Set(
          err.failedIds.map((id) => context.threadIdsByEmailId[id] || id),
        );
        const succeededThreadIds = new Set(
          err.succeededIds.map((id) => context.threadIdsByEmailId[id] || id),
        );
        for (const threadId of failedThreadIds) {
          forgetSuppressionClaim(
            variables.suppressionToken,
            threadId,
            context.suppressionIds[threadId],
          );
          releaseSuppression(threadId, context.suppressionIds[threadId]);
        }
        reconcilePartialInboxMutation(qc, context, succeededThreadIds);
        toast.error(toError(err).message);
        return;
      }
      for (const threadId of context?.threadIds ?? []) {
        forgetSuppressionClaim(
          variables.suppressionToken,
          threadId,
          context?.suppressionIds[threadId],
        );
        releaseSuppression(threadId, context?.suppressionIds[threadId]);
      }
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(toError(err).message);
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
  return { ...mutation, createSuppressionToken, getSuppressionIds };
}

/** Bulk star/unstar: queued + batched Gmail modify, one optimistic override. */
export function useBulkToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      targets,
      isStarred,
    }: {
      targets: BulkEmailTarget[];
      isStarred: boolean;
    }) =>
      enqueueBulkGmailMutation("star", targets, (target) => ({
        ...target,
        flag: isStarred,
      })).then(() => `Queued star for ${targets.length} email(s)`),
    onMutate: async ({ targets, isStarred }) => {
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const ids = new Set(targets.map((t) => t.id));
      const allEmails = previous.flatMap(([, data]) =>
        flattenInfiniteEmails(data),
      );
      const threadIdsByEmailId = resolveBulkThreadIds(qc, targets);
      const mutationVersions: Record<string, number> = {};
      for (const id of ids) {
        mutationVersions[id] = beginStarMutation(
          id,
          allEmails.find((email) => email.id === id)?.isStarred,
          isStarred,
        );
        setOptimisticOverride(id, { isStarred });
      }
      const inboxMutationId = toggleInboxThreadsStarOptimistic(
        qc,
        new Set(Object.values(threadIdsByEmailId)),
        isStarred,
      );
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { mutationVersions, threadIdsByEmailId, inboxMutationId };
    },
    onSuccess: (_data, vars, context) => {
      if (!context) return;
      const states = new Map<string, boolean | undefined | null>();
      for (const [id, version] of Object.entries(context.mutationVersions)) {
        states.set(id, confirmStarMutation(id, version, vars.isStarred));
      }
      applyStarMutationStates(states, context.threadIdsByEmailId);
    },
    onError: (err, vars, context) => {
      if (err instanceof BulkGmailMutationFailure && context) {
        const succeededThreadIds = new Set(
          err.succeededIds.map((id) => context.threadIdsByEmailId[id] || id),
        );
        const states = new Map<string, boolean | undefined | null>();
        for (const id of err.failedIds) {
          states.set(
            id,
            rollbackStarMutation(id, context.mutationVersions[id]),
          );
        }
        for (const id of err.succeededIds) {
          states.set(
            id,
            confirmStarMutation(
              id,
              context.mutationVersions[id],
              vars.isStarred,
            ),
          );
        }
        applyStarMutationStates(states, context.threadIdsByEmailId);
        reconcilePartialInboxMutation(qc, context, succeededThreadIds);
        toast.error(toError(err).message);
        return;
      }
      if (context) {
        const states = new Map<string, boolean | undefined | null>();
        for (const [id, version] of Object.entries(context.mutationVersions)) {
          states.set(id, rollbackStarMutation(id, version));
        }
        applyStarMutationStates(states, context.threadIdsByEmailId);
      }
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(toError(err).message);
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
}

/** Bulk mark read/unread: queued + batched Gmail modify, one optimistic override. */
export function useBulkMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      targets,
      isRead,
    }: {
      targets: BulkEmailTarget[];
      isRead: boolean;
    }) =>
      enqueueBulkGmailMutation("mark-read", targets, (target) => ({
        ...target,
        flag: isRead,
      })).then(() => `Queued mark-read for ${targets.length} email(s)`),
    onMutate: async ({ targets, isRead }) => {
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const ids = new Set(targets.map((t) => t.id));
      const allEmails = previous.flatMap(([, data]) =>
        flattenInfiniteEmails(data),
      );
      const threadIdsByEmailId = resolveBulkThreadIds(qc, targets);
      const mutationVersions: Record<string, number> = {};
      for (const id of ids) {
        mutationVersions[id] = beginReadMutation(
          id,
          allEmails.find((email) => email.id === id)?.isRead,
          isRead,
        );
        setOptimisticOverride(id, { isRead });
      }
      const inboxMutationId = markInboxThreadReadOptimistic(
        qc,
        new Set(Object.values(threadIdsByEmailId)),
        isRead,
      );
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { mutationVersions, threadIdsByEmailId, inboxMutationId };
    },
    onSuccess: (_data, vars, context) => {
      if (!context) return;
      const states = new Map<string, boolean | undefined | null>();
      for (const [id, version] of Object.entries(context.mutationVersions)) {
        states.set(id, confirmReadMutation(id, version, vars.isRead));
      }
      applyReadMutationStates(states);
    },
    onError: (err, vars, context) => {
      if (err instanceof BulkGmailMutationFailure && context) {
        const succeededThreadIds = new Set(
          err.succeededIds.map((id) => context.threadIdsByEmailId[id] || id),
        );
        const states = new Map<string, boolean | undefined | null>();
        for (const id of err.failedIds) {
          states.set(
            id,
            rollbackReadMutation(id, context.mutationVersions[id]),
          );
        }
        for (const id of err.succeededIds) {
          states.set(
            id,
            confirmReadMutation(id, context.mutationVersions[id], vars.isRead),
          );
        }
        applyReadMutationStates(states);
        reconcilePartialInboxMutation(qc, context, succeededThreadIds);
        toast.error(toError(err).message);
        return;
      }
      if (context) {
        const states = new Map<string, boolean | undefined | null>();
        for (const [id, version] of Object.entries(context.mutationVersions)) {
          states.set(id, rollbackReadMutation(id, version));
        }
        applyReadMutationStates(states);
      }
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
      toast.error(toError(err).message);
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
}

interface MoveEmailVars {
  id: string;
  label: string;
  removeLabel?: string;
  accountEmail?: string;
  accountEmails?: string;
  threadId?: string;
  threadIds?: string;
  suppressionToken?: SuppressionClaimToken;
}

export function useMoveEmail() {
  const qc = useQueryClient();
  const { createSuppressionToken, getSuppressionIds } = useSuppressionClaims();
  const mutation = useMutation({
    mutationFn: async ({
      id,
      label,
      removeLabel,
      accountEmail,
      accountEmails,
      threadId,
      threadIds,
    }: MoveEmailVars) => {
      const result = await callAction("move-email", {
        id,
        label,
        removeLabel,
        accountEmail,
        accountEmails,
        threadId,
        threadIds,
      });
      if (result.status === "partial")
        throw new MoveEmailPartialFailure(result);
      return result;
    },
    onMutate: async ({ id, removeLabel, suppressionToken }: MoveEmailVars) => {
      const cached = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const ids = id
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const threadIdsByEmailId: Record<string, string> = {};
      const targetEmails = cached.flatMap(([, data]) =>
        flattenInfiniteEmails(data),
      );
      for (const emailId of ids) {
        const target = targetEmails.find((email) => email.id === emailId);
        threadIdsByEmailId[emailId] =
          target?.threadId ||
          findInboxThreadIdByMessageId(qc, emailId) ||
          emailId;
      }
      const threadIds = new Set(Object.values(threadIdsByEmailId));
      const suppressionIds: Record<string, number> = {};
      for (const threadId of threadIds) {
        invalidateCachedThread(threadId);
        // Suppress per thread rather than snapshotting the legacy cache: a
        // snapshot restore also reverts whatever landed after this move
        // started, which is how an overlapping move gets resurrected. The
        // move drops INBOX and the source label it was handed; every other
        // label the thread carries still lists it.
        suppressionIds[threadId] = suppressThread(threadId, "move", {
          views: ["inbox", "unread"],
          label: removeLabel,
        });
        recordSuppressionClaim(
          suppressionToken,
          threadId,
          suppressionIds[threadId],
        );
      }
      const inboxMutationId = removeInboxThreadsOptimistic(qc, threadIds);
      for (const threadId of threadIds) {
        recordInboxMutationClaim(suppressionToken, threadId, inboxMutationId);
      }
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return {
        threadIds: [...threadIds],
        threadIdsByEmailId,
        suppressionIds,
        inboxMutationId,
      };
    },
    onError: (error, variables, context) => {
      if (!context) return;
      if (error instanceof MoveEmailPartialFailure) {
        const succeededThreadIds = new Set(
          error.result.succeeded.map(
            (id) => context.threadIdsByEmailId[id] || id,
          ),
        );
        for (const threadId of context.threadIds) {
          if (!succeededThreadIds.has(threadId)) {
            forgetSuppressionClaim(
              variables.suppressionToken,
              threadId,
              context.suppressionIds[threadId],
            );
            releaseSuppression(threadId, context.suppressionIds[threadId]);
          }
        }
        reconcilePartialInboxMutation(qc, context, succeededThreadIds);
        return;
      }
      for (const threadId of context.threadIds) {
        forgetSuppressionClaim(
          variables.suppressionToken,
          threadId,
          context.suppressionIds[threadId],
        );
        releaseSuppression(threadId, context.suppressionIds[threadId]);
      }
      if (context.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
  return { ...mutation, createSuppressionToken, getSuppressionIds };
}

export class MoveEmailPartialFailure extends Error {
  constructor(readonly result: MoveEmailResult) {
    super("Some email threads could not be moved");
    this.name = "MoveEmailPartialFailure";
  }
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body?: string;
      draftId?: string;
      replyToId?: string;
      replyToThreadId?: string;
      accountEmail?: string;
      attachments?: ComposeAttachment[];
    }) =>
      apiFetch<{ draftId: string }>("/api/emails/draft", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/draft/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useSendEmail() {
  const qc = useQueryClient();
  const { allAccounts } = useAccountFilter();
  return useMutation({
    mutationFn: (data: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      replyToId?: string;
      replyToThreadId?: string;
      accountEmail?: string;
      attachments?: ComposeAttachment[];
    }) =>
      apiFetch<{
        id: string;
        threadId?: string;
        labelIds?: string[];
        from?: EmailMessage["from"];
      }>("/api/emails/send", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onMutate: async (data) => {
      const settings = qc.getQueryData<UserSettings>(["settings"]);
      const cachedEmails = qc
        .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
        .flatMap(([, data]) => flattenInfiniteEmails(data));
      const replyTarget = data.replyToId
        ? cachedEmails.find((email) => email.id === data.replyToId)
        : undefined;
      const threadId =
        data.replyToThreadId ||
        replyTarget?.threadId ||
        data.replyToId ||
        makeTempId("thread");

      // Snapshot pre-send state so onError can roll back.
      const previousThread = getCachedThread(threadId);
      const previousLists = getRecentSentListSnapshots(qc);

      // Reuse the optimistic message that addOptimisticReply may have
      // already inserted, rather than double-adding.
      const existingMessages = previousThread ?? [];
      const existingOptimistic = existingMessages.find(
        (m) => m.id.startsWith("sent-") && m.isSent,
      );
      const rollbackThread = existingOptimistic
        ? existingMessages.filter((m) => m.id !== existingOptimistic.id)
        : previousThread;

      const optimisticMessage: EmailMessage = existingOptimistic ?? {
        id: makeTempId("sent"),
        threadId,
        from: resolveOptimisticSender(settings, allAccounts, data.accountEmail),
        to: parseRecipients(data.to),
        ...(data.cc ? { cc: parseRecipients(data.cc) } : {}),
        ...(data.bcc ? { bcc: parseRecipients(data.bcc) } : {}),
        subject: data.subject || "(no subject)",
        snippet: markdownPreviewSnippet(data.body),
        body: data.body,
        bodyHtml: bodyToHtml(data.body),
        date: new Date().toISOString(),
        isRead: true,
        isStarred: false,
        isSent: true,
        isArchived: false,
        isTrashed: false,
        labelIds: ["sent"],
        ...(data.attachments && data.attachments.length > 0
          ? {
              attachments: data.attachments.map((att) => ({
                id: att.id,
                filename: att.originalName,
                mimeType: att.mimeType,
                size: att.size,
                url: att.url,
              })),
            }
          : {}),
        ...(data.accountEmail ? { accountEmail: data.accountEmail } : {}),
      };

      if (!existingOptimistic) {
        setCachedThread(
          threadId,
          [...existingMessages, optimisticMessage].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          ),
        );
      }

      rememberRecentSentEmail(optimisticMessage);
      for (const [key] of previousLists) {
        qc.setQueryData<InfiniteEmails>(key, (old) =>
          upsertEmailInInfiniteList(old, optimisticMessage),
        );
      }

      return {
        previousThread: rollbackThread,
        optimisticMessage,
        threadId,
        previousLists,
      };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      forgetRecentSentEmail(context.optimisticMessage.id);
      context.previousLists.forEach(([key, data]) =>
        qc.setQueryData(key, data),
      );
      if (context.previousThread) {
        setCachedThread(context.threadId, context.previousThread);
      } else {
        invalidateCachedThread(context.threadId);
      }
    },
    onSuccess: (result, _vars, context) => {
      const threadId = result.threadId || context?.threadId;
      if (!threadId || !context?.optimisticMessage) return;

      const sourceThreadId = context.threadId;
      const current =
        getCachedThread(threadId) ??
        (sourceThreadId !== threadId
          ? getCachedThread(sourceThreadId)
          : undefined) ??
        [];
      const replacement = {
        ...context.optimisticMessage,
        id: result.id || context.optimisticMessage.id,
        threadId,
        ...(result.from ? { from: result.from } : {}),
        labelIds: result.labelIds?.map((id) => id.toLowerCase()) || ["sent"],
      };
      replaceRecentSentEmail(context.optimisticMessage.id, replacement);
      for (const [key] of getRecentSentListSnapshots(qc)) {
        qc.setQueryData<InfiniteEmails>(key, (old) =>
          replaceEmailInInfiniteList(
            old,
            context.optimisticMessage.id,
            replacement,
          ),
        );
      }
      const hasOptimistic = current.some(
        (message) => message.id === context.optimisticMessage.id,
      );
      setCachedThread(
        threadId,
        (hasOptimistic
          ? current.map((message) =>
              message.id === context.optimisticMessage.id
                ? replacement
                : message,
            )
          : [...current, replacement]
        ).sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        ),
      );
      if (sourceThreadId !== threadId) {
        invalidateCachedThread(sourceThreadId);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["emails"] });
    },
  });
}

export function useDeleteEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useReportSpam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      threadId,
      accountEmail,
    }: {
      id: string;
      threadId: string;
      accountEmail?: string;
    }) =>
      apiFetch(`/api/emails/${id}/spam`, {
        method: "POST",
        body: JSON.stringify({ accountEmail, threadId }),
      }),
    onMutate: async ({ threadId }) => {
      // Suppression hides the thread in the legacy list and the journal hides
      // it in the synced inbox, so rollback drops this thread's own entries.
      // Restoring a whole cache snapshot here would revert a concurrent
      // mutation that landed after this one started.
      // Suppression must be visible before awaiting cancellation so an undo
      // cannot miss a newer triage mutation that is already in flight.
      const suppressionId = suppressThread(threadId, "spam", {
        onlyIn: "spam",
      });
      const inboxMutationId = removeInboxThreadsOptimistic(
        qc,
        new Set([threadId]),
      );
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { threadId, suppressionId, inboxMutationId };
    },
    onError: (_err, _vars, context) => {
      if (context?.threadId)
        releaseSuppression(context.threadId, context.suppressionId);
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
}

export function useBlockSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      threadId,
      senderEmail,
      accountEmail,
    }: {
      id: string;
      threadId: string;
      senderEmail: string;
      accountEmail?: string;
    }) =>
      apiFetch(`/api/emails/${id}/block-sender`, {
        method: "POST",
        body: JSON.stringify({ senderEmail, accountEmail }),
      }),
    onMutate: async ({ threadId }) => {
      const suppressionId = suppressThread(threadId, "block", {
        onlyIn: "spam",
      });
      const inboxMutationId = removeInboxThreadsOptimistic(
        qc,
        new Set([threadId]),
      );
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { threadId, suppressionId, inboxMutationId };
    },
    onError: (_err, _vars, context) => {
      if (context?.threadId)
        releaseSuppression(context.threadId, context.suppressionId);
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
}

export function useMuteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      accountEmail,
    }: {
      threadId: string;
      accountEmail?: string;
    }) =>
      apiFetch(`/api/threads/${threadId}/mute`, {
        method: "POST",
        body: JSON.stringify({ accountEmail }),
      }),
    onMutate: async ({
      threadId,
    }: {
      threadId: string;
      accountEmail?: string;
    }) => {
      // Muting only drops the thread out of the inbox; All Mail and every
      // label it carries still list it.
      // Record the claim synchronously; undo of an older removal can run
      // while query cancellation for this mutation is still pending.
      const suppressionId = suppressThread(threadId, "mute", {
        views: ["inbox", "unread"],
      });
      const inboxMutationId = removeInboxThreadsOptimistic(
        qc,
        new Set([threadId]),
      );
      await Promise.all([
        qc.cancelQueries({ queryKey: ["emails"] }),
        cancelInboxThreadsQueries(qc),
      ]);
      return { threadId, suppressionId, inboxMutationId };
    },
    onError: (_err, _id, context) => {
      if (context?.threadId)
        releaseSuppression(context.threadId, context.suppressionId);
      if (context?.inboxMutationId) {
        forgetInboxMutation(qc, context.inboxMutationId);
      }
    },
    onSettled: (_data, _error, _variables, context) =>
      delayedInvalidate(
        qc,
        [["emails"], LABELS_QUERY_KEY, INBOX_THREADS_QUERY_KEY],
        3_000,
        () => settleInboxMutationIfObserved(qc, context?.inboxMutationId),
      ),
  });
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export type Contact = { name: string; email: string; count: number };

export function useContacts() {
  return useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => apiFetch("/api/contacts"),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const EMPTY_LABELS: Label[] = [];

/** Real action query key prefix for `list-labels` — matches every
 * `accountEmails` variant, unlike the old (dead) `["labels"]` literal every
 * caller used to invalidate. See useActionQuery's `["action", name, params]`
 * key shape. */
export const LABELS_QUERY_KEY = ["action", "list-labels"];

interface ListLabelsResult {
  labels: Label[];
  errors: Array<{ accountEmail: string; error: string }>;
}

/** `data` stays `Label[]` for existing consumers even though the action
 * returns `{ labels, errors }` — per-account label-fetch failures surface
 * separately via `accountErrors`. */
export function useLabels(accountEmails?: readonly string[]) {
  const accountFilter = accountEmails?.length
    ? [...new Set(accountEmails.map((email) => email.toLowerCase()))].sort()
    : undefined;
  const query = useActionQuery<ListLabelsResult>(
    "list-labels",
    accountFilter?.length ? { accountEmails: accountFilter } : {},
    {
      // A failed background refresh must not erase the last complete label map.
      // The layout still surfaces isError so an initial failure has an explicit
      // retry path instead of looking like an empty mailbox.
      placeholderData: (previousData) => previousData,
      staleTime: 60_000,
    },
  );
  const accountErrors: AccountError[] | undefined =
    !query.isPlaceholderData && query.data?.errors.length
      ? query.data.errors.map(({ accountEmail, error }) => ({
          email: accountEmail,
          error,
        }))
      : undefined;
  return { ...query, data: query.data?.labels, accountErrors };
}

// ─── Settings ────────────────────────────────────────────────────────────────

let pinnedLabelsUpdateTail: Promise<void> = Promise.resolve();
let savedFiltersUpdateTail: Promise<void> = Promise.resolve();
let pinnedLabelsUpdateToken = 0;
let pinnedLabelsOwnerEmail: string | undefined;
let confirmedPinnedLabels: string[] | undefined;
const savedFiltersBaseByPatch = new WeakMap<object, SavedMailFilter[]>();
const pendingPinnedLabelsIntents: Array<{
  base: string[];
  next: string[];
}> = [];

function normalizePinnedLabelsOwner(email?: string): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized || undefined;
}

function resetPinnedLabelsState(ownerEmail: string | undefined) {
  if (pinnedLabelsOwnerEmail === ownerEmail) return;
  pinnedLabelsOwnerEmail = ownerEmail;
  pinnedLabelsUpdateTail = Promise.resolve();
  pinnedLabelsUpdateToken += 1;
  confirmedPinnedLabels = undefined;
  pendingPinnedLabelsIntents.length = 0;
}

export function rebasePinnedLabelsUpdate(
  confirmed: readonly string[],
  base: readonly string[],
  next: readonly string[],
): string[] {
  const unique = (values: readonly string[]) => [...new Set(values)];
  const confirmedList = unique(confirmed);
  const baseList = unique(base);
  const nextList = unique(next);
  const baseSet = new Set(baseList);
  const nextSet = new Set(nextList);
  const baseRetained = baseList.filter((id) => nextSet.has(id));
  const nextRetained = nextList.filter((id) => baseSet.has(id));
  const intentReordered = nextRetained.some(
    (id, index) => id !== baseRetained[index],
  );
  const concurrentAdds = confirmedList.filter(
    (id) => !baseSet.has(id) && !nextSet.has(id),
  );

  if (intentReordered) return [...nextList, ...concurrentAdds];

  const rebased = confirmedList.filter(
    (id) => !baseSet.has(id) || nextSet.has(id),
  );
  const addedAfter = new Map<string, number>();

  for (const [index, id] of nextList.entries()) {
    if (baseSet.has(id)) continue;

    const previous = nextList
      .slice(0, index)
      .reverse()
      .find((candidate) => baseSet.has(candidate) && nextSet.has(candidate));
    const following = nextList
      .slice(index + 1)
      .find((candidate) => baseSet.has(candidate) && nextSet.has(candidate));

    if (previous) {
      const position = rebased.indexOf(previous);
      if (position >= 0) {
        const offset = addedAfter.get(previous) ?? 0;
        rebased.splice(position + 1 + offset, 0, id);
        addedAfter.set(previous, offset + 1);
        continue;
      }
    }
    if (following) {
      const position = rebased.indexOf(following);
      if (position >= 0) {
        rebased.splice(position, 0, id);
        continue;
      }
    }
    rebased.push(id);
  }

  return rebased;
}

export function serializePinnedLabelsUpdate<T>(
  task: () => Promise<T>,
): Promise<T> {
  const run = pinnedLabelsUpdateTail.then(task, task);
  pinnedLabelsUpdateTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function serializeSavedFiltersUpdate<T>(task: () => Promise<T>): Promise<T> {
  const run = savedFiltersUpdateTail.then(task, task);
  savedFiltersUpdateTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function useSettings() {
  return useQuery<UserSettings>({
    queryKey: ["settings"],
    queryFn: () => callAction("get-mail-preferences", {}, { method: "GET" }),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const ownerEmail = normalizePinnedLabelsOwner(settings?.email);

  useEffect(() => {
    resetPinnedLabelsState(ownerEmail);
  }, [ownerEmail]);

  return useMutation({
    mutationFn: (data: Partial<UserSettings>) => {
      if ("savedFilters" in data) {
        const base = savedFiltersBaseByPatch.get(data) ?? [];
        return serializeSavedFiltersUpdate(() =>
          callAction(
            "update-mail-preferences",
            {
              ...data,
              savedFiltersBase: base,
              requestSource: TAB_ID,
            },
            { method: "PUT" },
          ),
        );
      }
      if (!("pinnedLabels" in data)) {
        return callAction(
          "update-mail-preferences",
          { ...data, requestSource: TAB_ID },
          { method: "PUT" },
        );
      }

      const currentSettings = qc.getQueryData<UserSettings>(["settings"]);
      const currentOwnerEmail = normalizePinnedLabelsOwner(
        currentSettings?.email,
      );
      if (settingsLoading || !currentSettings || !currentOwnerEmail) {
        throw new Error("Mail preferences are still loading");
      }

      return serializePinnedLabelsUpdate(() => {
        if (pinnedLabelsOwnerEmail !== currentOwnerEmail) {
          throw new Error("Mail preferences changed accounts");
        }
        const intent = pendingPinnedLabelsIntents.shift();
        const confirmed = confirmedPinnedLabels ?? intent?.base ?? [];
        const rebased = intent
          ? rebasePinnedLabelsUpdate(confirmed, intent.base, intent.next)
          : (data.pinnedLabels ?? []);

        return callAction(
          "update-mail-preferences",
          {
            ...data,
            pinnedLabels: rebased,
            ...(intent && { pinnedLabelsBase: intent.base }),
            requestSource: TAB_ID,
          },
          { method: "PUT" },
        );
      });
    },
    onMutate: async (data) => {
      // Optimistic update: immediately merge into cached settings
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<UserSettings>(["settings"]);
      const hasPinnedLabels = "pinnedLabels" in data;
      if ("savedFilters" in data) {
        savedFiltersBaseByPatch.set(data, prev?.savedFilters ?? []);
      }
      if (hasPinnedLabels) {
        const owner = normalizePinnedLabelsOwner(prev?.email);
        if (settingsLoading || !prev || !owner) {
          return { prev, data, token: undefined, owner };
        }
        resetPinnedLabelsState(owner);
        pendingPinnedLabelsIntents.push({
          base: prev?.pinnedLabels ?? [],
          next: data.pinnedLabels ?? [],
        });
        if (!confirmedPinnedLabels) {
          confirmedPinnedLabels = prev?.pinnedLabels ?? [];
        }
      }
      const token = hasPinnedLabels ? ++pinnedLabelsUpdateToken : undefined;
      if (prev) {
        qc.setQueryData(["settings"], { ...prev, ...data });
      }
      return {
        prev,
        data,
        token,
        owner: normalizePinnedLabelsOwner(prev?.email),
      };
    },
    onError: (_err, _data, ctx) => {
      if (!ctx?.prev) return;

      const current = qc.getQueryData<UserSettings>(["settings"]);
      if (!current) return;

      if (
        ctx.token !== undefined &&
        (ctx.token !== pinnedLabelsUpdateToken ||
          ctx.owner !== pinnedLabelsOwnerEmail)
      ) {
        return;
      }

      const rollback: Partial<UserSettings> = {};
      let changed = false;
      for (const key of Object.keys(ctx.data) as (keyof UserSettings)[]) {
        if (current[key] === ctx.data[key]) {
          Object.assign(rollback, { [key]: ctx.prev[key] });
          changed = true;
        }
      }

      if (!changed) return;
      qc.setQueryData(["settings"], { ...current, ...rollback });
    },
    onSuccess: (data, variables, _context) => {
      if (
        "pinnedLabels" in variables &&
        normalizePinnedLabelsOwner(data.email) === pinnedLabelsOwnerEmail
      ) {
        confirmedPinnedLabels = data.pinnedLabels;
      }
    },
    onSettled: (_data, _error, variables) => {
      if ("savedFilters" in variables) {
        savedFiltersBaseByPatch.delete(variables);
      }
      const invalidations = [qc.invalidateQueries({ queryKey: ["settings"] })];
      if ("showAllTab" in variables) {
        invalidations.push(invalidateInboxThreads(qc));
      }
      return Promise.all(invalidations);
    },
  });
}

// ─── Email Tracking Stats ────────────────────────────────────────────────────

export type EmailTrackingStats = {
  opens: number;
  firstOpenedAt?: number;
  lastOpenedAt?: number;
  linkClicks: {
    url: string;
    count: number;
    firstClickedAt?: number;
    lastClickedAt?: number;
  }[];
  totalClicks: number;
};

export function useEmailTracking(messageId: string | undefined) {
  return useQuery<EmailTrackingStats>({
    queryKey: ["email-tracking", messageId],
    queryFn: () =>
      callAction<EmailTrackingStats>(
        "get-tracking",
        { id: messageId! },
        { method: "GET" },
      ),
    enabled: !!messageId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
