import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  suppressThread,
  unsuppressThread,
  mapInfiniteEmails,
  flattenInfiniteEmails,
  type InfiniteEmails,
} from "./use-emails";
import { appApiPath } from "@/lib/api-path";

export interface ScheduledJob {
  id: string;
  type: "snooze" | "send_later";
  ownerEmail?: string | null;
  emailId: string | null;
  threadId?: string | null;
  accountEmail?: string | null;
  payload: string; // JSON string
  runAt: number; // epoch ms
  status: "pending" | "processing" | "done" | "cancelled";
  createdAt: number;
}

export function useScheduledJobs() {
  return useQuery<ScheduledJob[]>({
    queryKey: ["scheduled-jobs"],
    queryFn: async () => {
      const res = await fetch(appApiPath("/api/scheduled-jobs"));
      if (!res.ok) throw new Error("Failed to fetch scheduled jobs");
      return res.json();
    },
    refetchInterval: 30_000, // Refresh every 30s
  });
}

export function useCreateScheduledJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      type: "snooze" | "send_later";
      emailId?: string;
      payload?: Record<string, unknown>;
      runAt: number;
    }) => {
      const res = await fetch(appApiPath("/api/scheduled-jobs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create job");
      return res.json() as Promise<ScheduledJob>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-jobs"] }),
  });
}

export function useSnoozeEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      emailId: string;
      runAt: number;
      accountEmail?: string;
    }) => {
      const res = await fetch(appApiPath(`/api/emails/${data.emailId}/snooze`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runAt: data.runAt,
          accountEmail: data.accountEmail,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to snooze email");
      }
      return res.json() as Promise<ScheduledJob>;
    },
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ["emails"] });
      const previous = qc.getQueriesData<InfiniteEmails>({
        queryKey: ["emails"],
      });
      const target = previous
        .flatMap(([, d]) => flattenInfiniteEmails(d))
        .find((e) => e.id === data.emailId);
      const threadId = target?.threadId || data.emailId;
      suppressThread(threadId, "snooze");
      qc.setQueriesData<InfiniteEmails>({ queryKey: ["emails"] }, (old) =>
        mapInfiniteEmails(old, (emails) =>
          emails.filter((e) => (e.threadId || e.id) !== threadId),
        ),
      );
      return { previous, threadId };
    },
    onError: (_err, _vars, context) => {
      if (context?.threadId) unsuppressThread(context.threadId);
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      // Delay email/label refetch — Gmail eventual consistency
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["emails"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
      }, 3000);
    },
  });
}

export function useScheduleEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      runAt: number;
      accountEmail?: string;
      from?: string;
      replyToId?: string;
      threadId?: string;
    }) => {
      const res = await fetch(appApiPath("/api/emails/schedule"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to schedule email");
      }
      return res.json() as Promise<ScheduledJob>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      qc.invalidateQueries({ queryKey: ["emails"] });
    },
  });
}

export function useDeleteScheduledJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(appApiPath(`/api/scheduled-jobs/${id}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to cancel job");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-jobs"] }),
  });
}

export function useParseDate() {
  return useMutation({
    mutationFn: async (data: { nlInput: string; timezone: string }) => {
      const res = await fetch(appApiPath("/api/parse-date"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to parse date");
      return res.json() as Promise<{
        timestamp: number | null;
        formatted: string | null;
      }>;
    },
  });
}
