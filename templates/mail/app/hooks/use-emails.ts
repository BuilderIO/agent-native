import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailMessage, Label, UserSettings } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";

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

// ─── Emails ──────────────────────────────────────────────────────────────────

export function useEmails(view: string = "inbox", search?: string) {
  return useQuery<EmailMessage[]>({
    queryKey: ["emails", view, search],
    queryFn: () => {
      const params = new URLSearchParams({ view });
      if (search) params.set("q", search);
      return apiFetch(`/api/emails?${params}`);
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useEmail(id: string | undefined) {
  return useQuery<EmailMessage>({
    queryKey: ["email", id],
    queryFn: () => apiFetch(`/api/emails/${id}`),
    enabled: !!id,
  });
}

export function useThreadMessages(threadId: string | undefined) {
  return useQuery<EmailMessage[]>({
    queryKey: ["thread-messages", threadId],
    queryFn: () => fetchThreadMessages(threadId!),
    enabled: !!threadId,
    staleTime: 30_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      apiFetch(`/api/emails/${id}/read`, {
        method: "PATCH",
        body: JSON.stringify({ isRead }),
      }),
    onMutate: async ({ id, isRead }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.map((e) => (e.id === id ? { ...e, isRead } : e)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => delayedInvalidate(qc, [["emails"], ["labels"]]),
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  // Stash unread IDs between onMutate (which computes them before the
  // optimistic update) and mutationFn (which sends the actual API calls).
  let pendingUnreadIds: string[] = [];
  return useMutation({
    mutationFn: async (_threadId: string) => {
      if (pendingUnreadIds.length > 0) {
        await Promise.all(
          pendingUnreadIds.map((id) =>
            apiFetch(`/api/emails/${id}/read`, {
              method: "PATCH",
              body: JSON.stringify({ isRead: true }),
            }),
          ),
        );
      }
    },
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      // Capture unread IDs BEFORE optimistic update
      const allEmails = previous.flatMap(([, data]) => data ?? []) ?? [];
      pendingUnreadIds = allEmails
        .filter((e) => (e.threadId || e.id) === threadId && !e.isRead)
        .map((e) => e.id);
      // Optimistic update
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.map((e) =>
          (e.threadId || e.id) === threadId ? { ...e, isRead: true } : e,
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

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      apiFetch(`/api/emails/${id}/star`, {
        method: "PATCH",
        body: JSON.stringify({ isStarred }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useArchiveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountEmail }: { id: string; accountEmail?: string }) =>
      apiFetch(`/api/emails/${id}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ accountEmail }),
      }),
    onMutate: async ({ id }: { id: string; accountEmail?: string }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, data]) => data ?? [])
        .find((e) => e.id === id);
      const threadId = target?.threadId || id;
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => (e.threadId || e.id) !== threadId),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
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
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      // Find the email across all cached queries to get its threadId
      const target = previous
        .flatMap(([, data]) => data ?? [])
        .find((e) => e.id === id);
      const threadId = target?.threadId || id;
      // Remove all thread messages from all cached email queries
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => (e.threadId || e.id) !== threadId),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
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
      await qc.cancelQueries({ queryKey: ["thread-messages"] });

      const previousThreads = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["thread-messages"],
      });
      const settings = qc.getQueryData<UserSettings>(["settings"]);
      const cachedEmails = qc
        .getQueriesData<EmailMessage[]>({ queryKey: ["emails"] })
        .flatMap(([, emails]) => emails ?? []);
      const replyTarget = data.replyToId
        ? cachedEmails.find((email) => email.id === data.replyToId)
        : undefined;
      const threadId =
        replyTarget?.threadId || data.replyToId || makeTempId("thread");
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

      qc.setQueryData<EmailMessage[]>(["thread-messages", threadId], (old) =>
        [...(old ?? []), optimisticMessage].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        ),
      );

      return { previousThreads, optimisticMessage, threadId };
    },
    onError: (_err, _vars, context) => {
      context?.previousThreads.forEach(([key, thread]) => {
        qc.setQueryData(key, thread);
      });
    },
    onSuccess: (result, _vars, context) => {
      const threadId = result.threadId || context?.threadId;
      if (!threadId || !context?.optimisticMessage) return;

      qc.setQueryData<EmailMessage[]>(["thread-messages", threadId], (old) =>
        (old ?? []).map((message) =>
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
      qc.invalidateQueries({ queryKey: ["thread-messages"] });
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
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      // Filter out entire thread, not just the single message
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => (e.threadId || e.id) !== threadId),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
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
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      // Filter out entire thread, not just the single message
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => (e.threadId || e.id) !== threadId),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useMuteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      apiFetch(`/api/threads/${threadId}/mute`, { method: "POST" }),
    onMutate: async (threadId: string) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => (e.threadId || e.id) !== threadId),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
