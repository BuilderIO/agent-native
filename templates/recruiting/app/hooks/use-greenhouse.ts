import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TAB_ID } from "@/lib/tab-id";
import type {
  GreenhouseJob,
  GreenhouseCandidate,
  GreenhouseApplication,
  GreenhouseJobStage,
  GreenhouseScheduledInterview,
  DashboardStats,
  PipelineStage,
  AgentNote,
  ActionItemsResponse,
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

// --- Auth ---

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
  return useQuery<GreenhouseJob[]>({
    queryKey: ["jobs", status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      return apiFetch(`/api/jobs?${params}`);
    },
    staleTime: 30_000,
  });
}

export function useJob(id: number | undefined) {
  return useQuery<GreenhouseJob>({
    queryKey: ["job", id],
    queryFn: () => apiFetch(`/api/jobs/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
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
  return useQuery<PipelineStage[]>({
    queryKey: ["job-pipeline", jobId],
    queryFn: () => apiFetch(`/api/jobs/${jobId}/pipeline`),
    enabled: !!jobId,
    staleTime: 15_000,
  });
}

// --- Candidates ---

export function useCandidates(params?: {
  search?: string;
  jobId?: number;
  limit?: number;
}) {
  return useQuery<GreenhouseCandidate[]>({
    queryKey: ["candidates", params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set("search", params.search);
      if (params?.jobId) qs.set("job_id", String(params.jobId));
      if (params?.limit) qs.set("limit", String(params.limit));
      return apiFetch(`/api/candidates?${qs}`);
    },
    staleTime: 30_000,
  });
}

export function useCandidate(id: number | undefined) {
  return useQuery<GreenhouseCandidate>({
    queryKey: ["candidate", id],
    queryFn: () => apiFetch(`/api/candidates/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

// --- Applications ---

export function useAdvanceApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      applicationId,
      fromStageId,
    }: {
      applicationId: number;
      fromStageId: number;
    }) =>
      apiFetch(`/api/applications/${applicationId}/advance`, {
        method: "PATCH",
        body: JSON.stringify({ from_stage_id: fromStageId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-pipeline"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["candidate"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useMoveApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      applicationId,
      fromStageId,
      toStageId,
    }: {
      applicationId: number;
      fromStageId: number;
      toStageId: number;
    }) =>
      apiFetch(`/api/applications/${applicationId}/move`, {
        method: "PATCH",
        body: JSON.stringify({
          from_stage_id: fromStageId,
          to_stage_id: toStageId,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-pipeline"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRejectApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      applicationId,
      rejectionReasonId,
      notes,
    }: {
      applicationId: number;
      rejectionReasonId?: number;
      notes?: string;
    }) =>
      apiFetch(`/api/applications/${applicationId}/reject`, {
        method: "PATCH",
        body: JSON.stringify({
          rejection_reason_id: rejectionReasonId,
          notes,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-pipeline"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["candidate"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// --- Interviews ---

export function useInterviews() {
  return useQuery<GreenhouseScheduledInterview[]>({
    queryKey: ["interviews"],
    queryFn: () => apiFetch("/api/interviews"),
    staleTime: 30_000,
  });
}

// --- Dashboard ---

export function useDashboard() {
  return useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch("/api/dashboard"),
    staleTime: 30_000,
  });
}

// --- Action Items ---

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

// --- Notifications ---

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
