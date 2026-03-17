import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailMessage, Label, UserSettings } from "@shared/types";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
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
    queryFn: () => apiFetch(`/api/threads/${threadId}/messages`),
    enabled: !!threadId,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useUnarchiveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/${id}/unarchive`, { method: "PATCH" }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      // Find threadId and unarchive all thread messages
      const target = previous
        .flatMap(([, data]) => data ?? [])
        .find((e) => e.id === id);
      const threadId = target?.threadId || id;
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.map((e) =>
          (e.threadId || e.id) === threadId ? { ...e, isArchived: false } : e,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
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
      apiFetch("/api/emails/send", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
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
    mutationFn: (id: string) =>
      apiFetch(`/api/emails/${id}/spam`, { method: "POST" }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => e.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

export function useBlockSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, senderEmail }: { id: string; senderEmail: string }) =>
      apiFetch(`/api/emails/${id}/block-sender`, {
        method: "POST",
        body: JSON.stringify({ senderEmail }),
      }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<EmailMessage[]>({
        queryKey: ["emails"],
      });
      qc.setQueriesData<EmailMessage[]>({ queryKey: ["emails"] }, (old) =>
        old?.filter((e) => e.id !== id),
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
