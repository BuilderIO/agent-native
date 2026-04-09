import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";
import type {
  GreenhouseJobStage,
  AgentNote,
  ActionItemsResponse,
  FilterResponse,
} from "@shared/types";

function apiFetch(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
      ...init?.headers,
    },
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body || res.statusText);
    }
    return res.json();
  });
}

// --- Auth (stays as API routes — requires H3 event context) ---

export function useGreenhouseStatus() {
  return useQuery<{ connected: boolean }>({
    queryKey: ["greenhouse-status"],
    queryFn: () => apiFetch("/api/greenhouse/status"),
    staleTime: 60_000,
  });
}

export function useGreenhouseConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) =>
      apiFetch("/api/greenhouse/key", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["greenhouse-status"] });
    },
  });
}

export function useGreenhouseDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/greenhouse/key", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["greenhouse-status"] });
      qc.clear();
    },
  });
}

// --- Jobs ---

export function useJobs(status?: string) {
  return useActionQuery("list-jobs", status ? { status } : undefined, {
    staleTime: 30_000,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

export function useJob(id: number | undefined) {
  return useActionQuery(
    "get-job",
    { id: String(id) },
    { enabled: !!id, staleTime: 30_000 },
  );
}

export function useJobStages(jobId: number | undefined) {
  return useQuery<GreenhouseJobStage[]>({
    queryKey: ["job-stages", jobId],
    queryFn: () => apiFetch(`/api/jobs/${jobId}/stages`),
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

export function useJobPipeline(jobId: number | undefined) {
  return useActionQuery(
    "get-pipeline",
    { jobId: String(jobId) },
    {
      enabled: !!jobId,
      staleTime: 15_000,
      select: (d) => (Array.isArray(d) ? d : []),
    },
  );
}

// --- Candidates ---

export function useCandidates(params?: {
  search?: string;
  jobId?: number;
  limit?: number;
}) {
  const actionParams: Record<string, string> = {};
  if (params?.search) actionParams.search = params.search;
  if (params?.jobId) actionParams.jobId = String(params.jobId);
  if (params?.limit) actionParams.limit = String(params.limit);

  return useActionQuery(
    "list-candidates",
    Object.keys(actionParams).length > 0 ? actionParams : undefined,
    { staleTime: 30_000, select: (d) => (Array.isArray(d) ? d : []) },
  );
}

export function useCandidate(id: number | undefined) {
  return useActionQuery(
    "get-candidate",
    { id: String(id) },
    { enabled: !!id, staleTime: 30_000 },
  );
}

// --- Applications ---

export function useAdvanceApplication() {
  const qc = useQueryClient();
  const mutation = useActionMutation("advance-candidate");

  return {
    ...mutation,
    mutate: (
      {
        applicationId,
        fromStageId,
      }: {
        applicationId: number;
        fromStageId: number;
      },
      options?: any,
    ) => {
      mutation.mutate(
        {
          applicationId: String(applicationId),
          fromStageId: String(fromStageId),
        },
        {
          ...options,
          onSuccess: (...args: any[]) => {
            qc.invalidateQueries({ queryKey: ["action"] });
            options?.onSuccess?.(...args);
          },
        },
      );
    },
  };
}

export function useMoveApplication() {
  const qc = useQueryClient();
  const mutation = useActionMutation("move-candidate");

  return {
    ...mutation,
    mutate: (
      {
        applicationId,
        fromStageId,
        toStageId,
      }: {
        applicationId: number;
        fromStageId: number;
        toStageId: number;
      },
      options?: any,
    ) => {
      mutation.mutate(
        {
          applicationId: String(applicationId),
          fromStageId: String(fromStageId),
          toStageId: String(toStageId),
        },
        {
          ...options,
          onSuccess: (...args: any[]) => {
            qc.invalidateQueries({ queryKey: ["action"] });
            options?.onSuccess?.(...args);
          },
        },
      );
    },
  };
}

export function useRejectApplication() {
  const qc = useQueryClient();
  const mutation = useActionMutation("reject-candidate");

  return {
    ...mutation,
    mutate: (
      {
        applicationId,
        rejectionReasonId,
        notes,
      }: {
        applicationId: number;
        rejectionReasonId?: number;
        notes?: string;
      },
      options?: any,
    ) => {
      const params: Record<string, string> = {
        applicationId: String(applicationId),
      };
      if (notes) params.notes = notes;
      mutation.mutate(params as any, {
        ...options,
        onSuccess: (...args: any[]) => {
          qc.invalidateQueries({ queryKey: ["action"] });
          options?.onSuccess?.(...args);
        },
      });
    },
  };
}

// --- Interviews ---

export function useInterviews() {
  return useActionQuery("list-interviews", undefined, {
    staleTime: 30_000,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// --- Dashboard ---

export function useDashboard() {
  return useActionQuery("dashboard-summary", undefined, {
    staleTime: 30_000,
    select: (d) => ({
      openJobs: d?.openJobs ?? 0,
      activeCandidates: d?.activeCandidates ?? 0,
      upcomingInterviews: d?.upcomingInterviews ?? 0,
      recentApplications: Array.isArray(d?.recentApplications)
        ? d.recentApplications
        : [],
    }),
  });
}

// --- Action Items (stays as API route — complex aggregation used by UI page) ---

export function useActionItems(params?: {
  overdueHours?: number;
  stuckDays?: number;
}) {
  return useQuery<ActionItemsResponse>({
    queryKey: ["action-items", params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params?.overdueHours)
        qs.set("overdue_hours", String(params.overdueHours));
      if (params?.stuckDays) qs.set("stuck_days", String(params.stuckDays));
      return apiFetch(`/api/action-items?${qs}`);
    },
    staleTime: 60_000,
  });
}

// --- Notifications (stays as API routes — requires H3 event context for role checks) ---

export function useNotificationStatus() {
  return useQuery<{ configured: boolean; enabled: boolean }>({
    queryKey: ["notification-status"],
    queryFn: () => apiFetch("/api/notifications/status"),
    staleTime: 60_000,
  });
}

export function useSaveNotificationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { webhookUrl: string; enabled?: boolean }) =>
      apiFetch("/api/notifications/config", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-status"] });
    },
  });
}

export function useDeleteNotificationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/notifications/config", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-status"] });
    },
  });
}

export function useSendRecruiterUpdate() {
  return useMutation({
    mutationFn: (data: {
      actionItems: ActionItemsResponse;
      customMessage?: string;
    }) =>
      apiFetch("/api/notifications/send", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

// --- Notes ---

export function useNotes(candidateId: number | undefined) {
  return useQuery<AgentNote[]>({
    queryKey: ["notes", candidateId],
    queryFn: () => apiFetch(`/api/notes?candidate_id=${candidateId}`),
    enabled: !!candidateId,
    staleTime: 15_000,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      candidateId: number;
      content: string;
      type: string;
    }) =>
      apiFetch("/api/notes", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["notes", vars.candidateId] });
    },
  });
}

// --- AI Filter ---

export function useFilterCandidates() {
  return useMutation<
    FilterResponse,
    Error,
    { prompt: string; jobId?: number; limit?: number }
  >({
    mutationFn: (data) =>
      apiFetch("/api/candidates/filter", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, candidateId }: { id: string; candidateId: number }) =>
      apiFetch(`/api/notes/${id}`, { method: "DELETE" }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["notes", vars.candidateId] });
    },
  });
}
