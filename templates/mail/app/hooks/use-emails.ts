import { useMemo } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { EmailMessage, Label, UserSettings } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";
import { bodyToHtml } from "@/lib/utils";
import {
  useThreadCache,
  ensureThread,
  invalidateCachedThread,
  getCachedThread,
  setCachedThread,
} from "@/lib/thread-cache";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function fetchThreadMessages(threadId: string): Promise<EmailMessage[]> {
  return apiFetch(`/api/threads/${threadId}/messages`);
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
    for (const key of keys) qc.invalidateQueries({ queryKey: key });
  }, ms);
}

// ─── Optimistic sent message ────────────────────────────────────────────────
// Used to show a reply in the thread immediately when the user clicks Send,
// before the 5-second undo delay fires the actual mutation.

export function useAddOptimisticReply() {
  const qc = useQueryClient();

  return (data: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    replyToId?: string;
    replyToThreadId?: string;
    accountEmail?: string;
  }): (() => void) | undefined => {
    const settings = qc.getQueryData<UserSettings>(["settings"]);
    const threadId = data.replyToThreadId || data.replyToId;
    if (!threadId) return;

    const optimisticMessage: EmailMessage = {
      id: makeTempId("sent"),
      threadId,
      from: {
        name: settings?.name || settings?.email || data.accountEmail || "Me",
        email: data.accountEmail || settings?.email || "",
      },
      to: parseRecipients(data.to),
      ...(data.cc ? { cc: parseRecipients(data.cc) } : {}),
      subject: data.subject || "(no subject)",
      snippet: data.body.slice(0, 120).replace(/\n/g, " "),
      body: data.body,
      bodyHtml: bodyToHtml(data.body),
      date: new Date().toISOString(),
      isRead: true,
      isStarred: false,
      isSent: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["sent"],
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

function filterSuppressed(
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

// ─── Emails ──────────────────────────────────────────────────────────────────

interface EmailsPage {
  emails: EmailMessage[];
  nextPageToken?: string;
  totalEstimate?: number;
}

export function useEmails(view: string = "inbox", search?: string) {
  const q = useInfiniteQuery({
    queryKey: ["emails", view, search],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ view });
      if (search) params.set("q", search);
      if (pageParam) params.set("pageToken", pageParam);
      return apiFetch<EmailsPage>(`/api/emails?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: EmailsPage) => lastPage.nextPageToken,
    staleTime: 15_000,
    refetchInterval: (query: { state: { status: string } }) =>
      query.state.status === "error" ? false : 30_000,
    refetchOnWindowFocus: "always" as const,
    retry: false,
  });

  const data = useMemo(() => {
    if (!q.data) return undefined;
    const all = q.data.pages.flatMap((p: EmailsPage) => p.emails);
    return applyOverrides(filterSuppressed(all, view));
  }, [q.data, view]);

  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
    hasNextPage: q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
  };
}

export function useEmail(id: string | undefined) {
  return useQuery<EmailMessage>({
    queryKey: ["email", id],
    queryFn: () => apiFetch(`/api/emails/${id}`),
    enabled: !!id,
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
        return ensureThread(threadId);
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
    }: {
      id: string;
      isRead: boolean;
      accountEmail?: string;
    }) =>
      apiFetch(`/api/emails/${id}/read`, {
        method: "PATCH",
        body: JSON.stringify({ isRead, accountEmail }),
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
  // Per-thread pending entries — using a Map so concurrent mutations for different
  // threads don't overwrite each other's pending entries.
  const pendingByThread = new Map<
    string,
    { id: string; accountEmail?: string }[]
  >();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const entries = pendingByThread.get(threadId) ?? [];
      pendingByThread.delete(threadId);
      if (entries.length > 0) {
        await Promise.all(
          entries.map(({ id, accountEmail }) =>
            apiFetch(`/api/emails/${id}/read`, {
              method: "PATCH",
              body: JSON.stringify({ isRead: true, accountEmail }),
            }),
          ),
        );
      }
    },
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      // Capture unread entries BEFORE optimistic update
      const allEmails =
        previous.flatMap(([, data]) => flattenInfiniteEmails(data)) ?? [];
      const unreadEntries = allEmails
        .filter((e) => (e.threadId || e.id) === threadId && !e.isRead)
        .map((e) => ({ id: e.id, accountEmail: e.accountEmail }));
      pendingByThread.set(threadId, unreadEntries);
      const unreadIds = unreadEntries.map((e) => e.id);
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
      return { previous, overrideIds: [...unreadIds] };
    },
    onError: (_err, _vars, context) => {
      for (const id of context?.overrideIds ?? []) {
        clearOptimisticOverride(id);
      }
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      apiFetch(`/api/emails/${id}/star`, {
        method: "PATCH",
        body: JSON.stringify({ isStarred }),
      }),
    onMutate: async ({ id, isStarred }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      setOptimisticOverride(id, { isStarred });
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.map((e) => (e.id === id ? { ...e, isStarred } : e)),
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

export function useArchiveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      accountEmail,
      removeLabel,
    }: {
      id: string;
      accountEmail?: string;
      removeLabel?: string;
    }) =>
      apiFetch(`/api/emails/${id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ accountEmail, removeLabel }),
      }),
    onMutate: async ({
      id,
    }: {
      id: string;
      accountEmail?: string;
      removeLabel?: string;
    }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, data]) => flattenInfiniteEmails(data))
        .find((e) => e.id === id);
      const threadId = target?.threadId || id;
      suppressThread(threadId, "archive");
      invalidateCachedThread(threadId);
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

export function useUnarchiveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/${id}/unarchive`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useUntrashEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/${id}/untrash`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useTrashEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/${id}/trash`, { method: "PATCH" }),
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
  return useMutation({
    mutationFn: (data: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      replyToId?: string;
      accountEmail?: string;
    }) =>
      apiFetch<{ id: string; threadId?: string; labelIds?: string[] }>(
        "/api/emails/send",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    onMutate: async (data) => {
      const settings = qc.getQueryData<UserSettings>(["settings"]);
      const cachedEmails = qc
        .getQueriesData<InfiniteEmails>({ queryKey: ["emails"] })
        .flatMap(([, data]) => flattenInfiniteEmails(data));
      const replyTarget = data.replyToId
        ? cachedEmails.find((email) => email.id === data.replyToId)
        : undefined;
      const threadId =
        replyTarget?.threadId || data.replyToId || makeTempId("thread");

      // Snapshot pre-send thread state so onError can roll back.
      const previousThread = getCachedThread(threadId);

      // Reuse the optimistic message that addOptimisticReply may have
      // already inserted, rather than double-adding.
      const existingMessages = previousThread ?? [];
      const existingOptimistic = existingMessages.find(
        (m) => m.id.startsWith("sent-") && m.isSent,
      );

      if (existingOptimistic) {
        return {
          previousThread,
          optimisticMessage: existingOptimistic,
          threadId,
        };
      }

      // No prior optimistic message (e.g. sent from ComposeModal) — add one
      const optimisticMessage: EmailMessage = {
        id: makeTempId("sent"),
        threadId,
        from: {
          name: settings?.name || settings?.email || data.accountEmail || "Me",
          email: data.accountEmail || settings?.email || "",
        },
        to: parseRecipients(data.to),
        ...(data.cc ? { cc: parseRecipients(data.cc) } : {}),
        ...(data.bcc ? { bcc: parseRecipients(data.bcc) } : {}),
        subject: data.subject || "(no subject)",
        snippet: data.body.slice(0, 120).replace(/\n/g, " "),
        body: data.body,
        date: new Date().toISOString(),
        isRead: true,
        isStarred: false,
        isSent: true,
        isArchived: false,
        isTrashed: false,
        labelIds: ["sent"],
        ...(data.accountEmail ? { accountEmail: data.accountEmail } : {}),
      };

      setCachedThread(
        threadId,
        [...existingMessages, optimisticMessage].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        ),
      );

      return { previousThread, optimisticMessage, threadId };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      if (context.previousThread) {
        setCachedThread(context.threadId, context.previousThread);
      } else {
        invalidateCachedThread(context.threadId);
      }
    },
    onSuccess: (result, _vars, context) => {
      const threadId = result.threadId || context?.threadId;
      if (!threadId || !context?.optimisticMessage) return;

      const current = getCachedThread(threadId) ?? [];
      setCachedThread(
        threadId,
        current.map((message) =>
          message.id === context.optimisticMessage.id
            ? {
                ...message,
                id: result.id || message.id,
                threadId,
                labelIds: result.labelIds?.map((id) => id.toLowerCase()) || [
                  "sent",
                ],
              }
            : message,
        ),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["emails"] });
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
    staleTime: 60_000,
  });
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function useLabels() {
  return useQuery<Label[]>({
    queryKey: ["labels"],
    queryFn: () => apiFetch("/api/labels"),
    staleTime: 60_000,
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery<UserSettings>({
    queryKey: ["settings"],
    queryFn: () => apiFetch("/api/settings"),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<UserSettings>) =>
      apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onMutate: async (data) => {
      // Optimistic update: immediately merge into cached settings
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<UserSettings>(["settings"]);
      if (prev) {
        qc.setQueryData(["settings"], { ...prev, ...data });
      }
      return { prev };
    },
    onError: (_err, _data, ctx) => {
      // Rollback on error
      if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
