import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { IssueListParams } from "@shared/types";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.statusMessage || body.error || `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json();
}

export function useIssues(params: IssueListParams) {
  const searchParams = new URLSearchParams();
  if (params.view) searchParams.set("view", params.view);
  if (params.projectKey) searchParams.set("projectKey", params.projectKey);
  if (params.jql) searchParams.set("jql", params.jql);
  if (params.q) searchParams.set("q", params.q);
  if (params.nextPageToken)
    searchParams.set("nextPageToken", params.nextPageToken);
  if (params.maxResults !== undefined)
    searchParams.set("maxResults", String(params.maxResults));

  return useQuery({
    queryKey: ["issues", params],
    queryFn: () => apiFetch(`/api/issues?${searchParams}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => {
      // Don't retry auth errors — user needs to reconnect
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
  });
}

export function useIssue(issueKey: string | undefined) {
  return useQuery({
    queryKey: ["issue", issueKey],
    queryFn: () => apiFetch(`/api/issues/${issueKey}`),
    enabled: !!issueKey,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create issue");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues"] });
    },
  });
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      issueKey,
      body,
    }: {
      issueKey: string;
      body: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/issues/${issueKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update issue");
      return res.json();
    },
    onSuccess: (_, { issueKey }) => {
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issue", issueKey] });
    },
  });
}
