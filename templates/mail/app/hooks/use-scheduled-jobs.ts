import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ScheduledJob {
  id: string;
  type: "snooze" | "send_later";
  emailId: string | null;
  payload: string; // JSON string
  runAt: number; // epoch ms
  status: "pending" | "processing" | "done" | "cancelled";
  createdAt: number;
}

export function useScheduledJobs() {
  return useQuery<ScheduledJob[]>({
    queryKey: ["scheduled-jobs"],
    queryFn: async () => {
      const res = await fetch("/api/scheduled-jobs");
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
      const res = await fetch("/api/scheduled-jobs", {
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

export function useDeleteScheduledJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled-jobs/${id}`, {
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
      const res = await fetch("/api/parse-date", {
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
