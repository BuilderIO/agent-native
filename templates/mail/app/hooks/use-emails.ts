import { appApiPath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
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
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { useAccountFilter } from "@/hooks/use-account-filter";
import { gmailMutationQueue } from "@/lib/gmail-mutation-queue";
import { TAB_ID } from "@/lib/tab-id";
import {
  useThreadCache,
  ensureThread,
  invalidateCachedThread,
  getCachedThread,
  setCachedThread,
} from "@/lib/thread-cache";
import { bodyToHtml } from "@/lib/utils";

const EMAIL_PAGE_SIZE = 25;

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

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(appApiPath(url), {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.error || `Request failed (${res.status})`);
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return res.json();
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
) {
  setTimeout(() => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: key });
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

const suppressedThreads = new Map<
  string,
  { action: string; timestamp: number }
>();
const SUPPRESS_DURATION = 60_000; // 60s — covers Gmail's consistency window

/** Suppress a thread from appearing in views it was removed from. */
export function suppressThread(
  threadId: string,
  action: "archive" | "trash" | "spam" | "block" | "mute" | "snooze",
) {
  suppressedThreads.set(threadId, { action, timestamp: Date.now() });
}

/** Remove suppression — used on mutation error rollback. */
export function unsuppressThread(threadId: string) {
  suppressedThreads.delete(threadId);
}

function isSuppressedInView(threadId: string, view: string): boolean {
  const entry = suppressedThreads.get(threadId);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > SUPPRESS_DURATION) {
    suppressedThreads.delete(threadId);
    return false;
  }
  // Don't suppress in the "destination" view for the action
  if (entry.action === "archive" && view === "archive") return false;
  if (entry.action === "trash" && view === "trash") return false;
  return true;
}

export function filterSuppressedThreads(
  emails: EmailMessage[],
  view: string,
): EmailMessage[] {
  if (suppressedThreads.size === 0) return emails;
  return emails.filter((e) => !isSuppressedInView(e.threadId || e.id, view));
}

// ─── Optimistic property overrides ──────────────────────────────────────────
// Gmail's eventual consistency means refetches can return stale read/star state,
// overwriting optimistic updates. We track local overrides here and apply them
// in the `select` transform so the UI never flickers back to stale state.

const optimisticOverrides = new Map<
  string,
  { props: Partial<EmailMessage>; timestamp: number }
>();
const OVERRIDE_DURATION = 60_000; // 60s — covers Gmail's consistency window

/** Set optimistic property overrides for an email (read, star, etc.) */
export function setOptimisticOverride(
  emailId: string,
  props: Partial<EmailMessage>,
) {
  const existing = optimisticOverrides.get(emailId);
  optimisticOverrides.set(emailId, {
    props: { ...(existing?.props ?? {}), ...props },
    timestamp: Date.now(),
  });
}

/** Clear optimistic overrides — used on mutation error rollback. */
export function clearOptimisticOverride(emailId: string) {
  optimisticOverrides.delete(emailId);
}

function applyOverrides(emails: EmailMessage[]): EmailMessage[] {
  if (optimisticOverrides.size === 0) return emails;
  const now = Date.now();
  let changed = false;
  const result = emails.map((e) => {
    const entry = optimisticOverrides.get(e.id);
    if (!entry) return e;
    if (now - entry.timestamp > OVERRIDE_DURATION) {
      optimisticOverrides.delete(e.id);
      return e;
    }
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

interface EmailsPage {
  emails: EmailMessage[];
  nextPageToken?: string;
  totalEstimate?: number;
}

export function useEmails(
  view: string = "inbox",
  search?: string,
  label?: string,
  options?: { enabled?: boolean },
) {
  const q = useInfiniteQuery({
    queryKey: ["emails", view, search, label],
    queryFn: ({
      pageParam,
      signal,
    }: {
      pageParam: string | undefined;
      signal: AbortSignal;
    }) => {
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
      return apiFetch<EmailsPage>(`/api/emails?${params}`, { signal });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: EmailsPage) => lastPage.nextPageToken,
    // Gmail's per-user quota is tight. Keep pages modest and refetches
    // conservative; thread list hydration is quota-expensive even when batched.
    // Search queries get a short cache window so repeated renders/back
    // navigation do not re-hydrate the same expensive Gmail search immediately.
    // refetchOnWindowFocus stays off: with useInfiniteQuery it replays every
    // cached page (50+ Gmail calls each) on tab focus and trips the quota.
    staleTime: search ? 30_000 : 60_000,
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
    retry: false,
    enabled: options?.enabled ?? true,
  });

  const data = useMemo(() => {
    if (!q.data) return undefined;
    const all = q.data.pages.flatMap((p: EmailsPage) => p.emails);
    const visible = applyOverrides(filterSuppressedThreads(all, view));
    return applyRecentSentEmails(visible, view, search, label);
  }, [q.data, view, search, label]);

  return {
    data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isRefetching: q.isRefetching,
    // Keep stale data visible when a background refetch fails (usually Gmail
    // quota cooldown). Showing the full error state while data exists makes
    // the inbox appear to flash/reload even though the old page is usable.
    isError: q.isError && !q.data,
    error: q.isError && !q.data ? toError(q.error) : null,
    totalEstimate: q.data?.pages[0]?.totalEstimate,
    refetch: q.refetch,
    hasNextPage: q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    isFetchNextPageError: q.isFetchNextPageError,
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
  const { messages, isFromCache, isLoading } = useThreadCache(
    threadId,
    placeholder,
    placeholder?.[0]?.accountEmail,
  );
  return {
    data: messages,
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
    onMutate: async ({ id, isRead }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      setOptimisticOverride(id, { isRead });
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.map((e) => (e.id === id ? { ...e, isRead } : e)),
        ),
      );
      return { previous };
    },
    onError: (_err, { id }, context) => {
      clearOptimisticOverride(id);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      callAction("mark-thread-read", { threadId }).then(assertActionSuccess),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      // Capture unread entries BEFORE optimistic update
      const allEmails =
        previous.flatMap(([, data]) => flattenInfiniteEmails(data)) ?? [];
      const unreadIds = allEmails
        .filter((e) => (e.threadId || e.id) === threadId && !e.isRead)
        .map((e) => e.id);
      const previousThread = getCachedThread(threadId);
      // Set overrides so refetches don't revert read state
      for (const id of unreadIds) {
        setOptimisticOverride(id, { isRead: true });
      }
      // Optimistic update
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.map((e) =>
            (e.threadId || e.id) === threadId ? { ...e, isRead: true } : e,
          ),
        ),
      );
      if (previousThread) {
        setCachedThread(
          threadId,
          previousThread.map((message) => ({ ...message, isRead: true })),
        );
      }
      return { previous, overrideIds: [...unreadIds], previousThread };
    },
    onError: (_err, threadId, context) => {
      for (const id of context?.overrideIds ?? []) {
        clearOptimisticOverride(id);
      }
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      if (context?.previousThread) {
        setCachedThread(threadId, context.previousThread);
      }
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
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
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const resolvedThreadId = threadId || target?.threadId || target?.id;
      const previousThread = resolvedThreadId
        ? getCachedThread(resolvedThreadId)
        : undefined;
      setOptimisticOverride(id, { isStarred });
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.map((e) => (e.id === id ? { ...e, isStarred } : e)),
        ),
      );
      if (resolvedThreadId && previousThread) {
        setCachedThread(
          resolvedThreadId,
          previousThread.map((message) =>
            message.id === id ? { ...message, isStarred } : message,
          ),
        );
      }
      return { previous, previousThread, threadId: resolvedThreadId };
    },
    onError: (_err, { id }, context) => {
      clearOptimisticOverride(id);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      if (context?.threadId && context.previousThread) {
        setCachedThread(context.threadId, context.previousThread);
      }
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useArchiveEmail() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: ({
      id,
      accountEmail,
      removeLabel,
      threadId,
    }: {
      id: string;
      accountEmail?: string;
      removeLabel?: string;
      threadId?: string;
    }) =>
      gmailMutationQueue.enqueue("archive", {
        id,
        accountEmail,
        removeLabel,
        threadId,
      }),
    onMutate: async ({
      id,
      threadId: hintedThreadId,
    }: {
      id: string;
      accountEmail?: string;
      removeLabel?: string;
      threadId?: string;
    }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const threadId = hintedThreadId || target?.threadId || id;
      suppressThread(threadId, "archive");
      invalidateCachedThread(threadId);
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous, threadId };
    },
    onError: (err, _vars, context) => {
      if (context?.threadId) unsuppressThread(context.threadId);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(
        archiveFailureToastMessage(err, t("mail.toasts.archiveFailed")),
      );
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useUnarchiveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      // Undo often lands inside the debounce window — drop the pending
      // archive so we never send a modify we immediately reverse.
      const cancelled = gmailMutationQueue.cancel("archive", id);
      if (cancelled) return Promise.resolve("cancelled-pending-archive");
      return callAction("unarchive-email", { id }).then(assertActionSuccess);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useUntrashEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callAction("untrash-email", { id }).then(assertActionSuccess),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useTrashEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callAction("trash-email", { id }).then(assertActionSuccess),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      // Find the email across all cached queries to get its threadId
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const threadId = target?.threadId || id;
      suppressThread(threadId, "trash");
      // Remove all thread messages from all cached email queries
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous, threadId };
    },
    onError: (_err, _id, context) => {
      if (context?.threadId) unsuppressThread(context.threadId);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export interface BulkEmailTarget {
  id: string;
  threadId?: string;
  accountEmail?: string;
}

function bulkActionArgs(targets: BulkEmailTarget[]) {
  return {
    id: targets.map((t) => t.id).join(","),
    threadIds: targets.map((t) => t.threadId ?? "").join(","),
    accountEmails: targets.map((t) => t.accountEmail ?? "").join(","),
  };
}

interface BulkArchiveVars {
  targets: BulkEmailTarget[];
  removeLabel?: string;
}

/**
 * Bulk archive: one action call carrying every selected id (server batches
 * into one Gmail call per account) plus one optimistic cache update, instead
 * of N mutate() calls each racing their own cache write/rollback.
 */
export function useBulkArchiveEmails() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: ({ targets, removeLabel }: BulkArchiveVars) =>
      Promise.all(
        targets.map((target) =>
          gmailMutationQueue.enqueue("archive", {
            ...target,
            removeLabel,
          }),
        ),
      ).then(() => `Queued archive for ${targets.length} email(s)`),
    onMutate: async ({ targets }: BulkArchiveVars) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const allEmails = previous.flatMap(([, data]) =>
        flattenInfiniteEmails(data),
      );
      const threadIds = targets.map((target) => {
        const found = allEmails.find((e) => e.id === target.id);
        return target.threadId || found?.threadId || target.id;
      });
      const threadIdSet = new Set(threadIds);
      for (const threadId of threadIdSet) {
        suppressThread(threadId, "archive");
        invalidateCachedThread(threadId);
      }
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => !threadIdSet.has(e.threadId || e.id)),
        ),
      );
      return { previous, threadIds: [...threadIdSet] };
    },
    onError: (err, _vars, context) => {
      for (const threadId of context?.threadIds ?? []) {
        unsuppressThread(threadId);
      }
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(
        archiveFailureToastMessage(err, t("mail.toasts.archiveFailed")),
      );
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

/**
 * Bulk trash: one action call for every selected id — the server fans the
 * Gmail calls out with bounded concurrency (no Gmail batch endpoint exists
 * for trash) — plus one optimistic cache update.
 */
export function useBulkTrashEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targets: BulkEmailTarget[]) =>
      callAction("trash-email", bulkActionArgs(targets)).then(
        assertActionSuccess,
      ),
    onMutate: async (targets: BulkEmailTarget[]) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const allEmails = previous.flatMap(([, data]) =>
        flattenInfiniteEmails(data),
      );
      const threadIds = targets.map((target) => {
        const found = allEmails.find((e) => e.id === target.id);
        return target.threadId || found?.threadId || target.id;
      });
      const threadIdSet = new Set(threadIds);
      for (const threadId of threadIdSet) suppressThread(threadId, "trash");
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => !threadIdSet.has(e.threadId || e.id)),
        ),
      );
      return { previous, threadIds: [...threadIdSet] };
    },
    onError: (_err, _vars, context) => {
      for (const threadId of context?.threadIds ?? []) {
        unsuppressThread(threadId);
      }
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
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
      Promise.all(
        targets.map((target) =>
          gmailMutationQueue.enqueue("star", {
            ...target,
            flag: isStarred,
          }),
        ),
      ).then(() => `Queued star for ${targets.length} email(s)`),
    onMutate: async ({ targets, isStarred }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const ids = new Set(targets.map((t) => t.id));
      for (const id of ids) setOptimisticOverride(id, { isStarred });
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.map((e) => (ids.has(e.id) ? { ...e, isStarred } : e)),
        ),
      );
      return { previous, ids: [...ids] };
    },
    onError: (_err, _vars, context) => {
      for (const id of context?.ids ?? []) clearOptimisticOverride(id);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
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
      Promise.all(
        targets.map((target) =>
          gmailMutationQueue.enqueue("mark-read", {
            ...target,
            flag: isRead,
          }),
        ),
      ).then(() => `Queued mark-read for ${targets.length} email(s)`),
    onMutate: async ({ targets, isRead }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const ids = new Set(targets.map((t) => t.id));
      for (const id of ids) setOptimisticOverride(id, { isRead });
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.map((e) => (ids.has(e.id) ? { ...e, isRead } : e)),
        ),
      );
      return { previous, ids: [...ids] };
    },
    onError: (_err, _vars, context) => {
      for (const id of context?.ids ?? []) clearOptimisticOverride(id);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useMoveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      label,
      removeLabel,
    }: {
      id: string;
      label: string;
      removeLabel?: string;
    }) => callAction("move-email", { id, label, removeLabel }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const threadId = target?.threadId || id;
      invalidateCachedThread(threadId);
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
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
    mutationFn: ({ id, threadId }: { id: string; threadId: string }) =>
      apiFetch(`/api/emails/${id}/spam`, { method: "POST" }),
    onMutate: async ({ threadId }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      suppressThread(threadId, "spam");
      // Filter out entire thread, not just the single message
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous, threadId };
    },
    onError: (_err, _vars, context) => {
      if (context?.threadId) unsuppressThread(context.threadId);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useBlockSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      threadId,
      senderEmail,
    }: {
      id: string;
      threadId: string;
      senderEmail: string;
    }) =>
      apiFetch(`/api/emails/${id}/block-sender`, {
        method: "POST",
        body: JSON.stringify({ senderEmail }),
      }),
    onMutate: async ({ threadId }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      suppressThread(threadId, "block");
      // Filter out entire thread, not just the single message
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous, threadId };
    },
    onError: (_err, _vars, context) => {
      if (context?.threadId) unsuppressThread(context.threadId);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useMuteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      apiFetch(`/api/threads/${threadId}/mute`, { method: "POST" }),
    onMutate: async (threadId: string) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      suppressThread(threadId, "mute");
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous, threadId };
    },
    onError: (_err, _id, context) => {
      if (context?.threadId) unsuppressThread(context.threadId);
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
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

export function useLabels(accountEmails?: readonly string[]) {
  const accountFilter = accountEmails?.length
    ? [...new Set(accountEmails.map((email) => email.toLowerCase()))].sort()
    : undefined;
  return useQuery<Label[]>({
    queryKey: ["labels", accountFilter],
    queryFn: () => {
      const params = accountFilter?.length
        ? `?accountEmails=${encodeURIComponent(accountFilter.join(","))}`
        : "";
      return apiFetch(`/api/labels${params}`);
    },
    // A failed background refresh must not erase the last complete label map.
    // The layout still surfaces isError so an initial failure has an explicit
    // retry path instead of looking like an empty mailbox.
    placeholderData: (previousData) => previousData,
    staleTime: 60_000,
  });
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
      return qc.invalidateQueries({ queryKey: ["settings"] });
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
