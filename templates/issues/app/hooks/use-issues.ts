import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { IssueListParams } from "@shared/types";

export function useIssues(params: IssueListParams) {
  const searchParams = new URLSearchParams();
  if (params.view) searchParams.set("view", params.view);
  if (params.projectKey) searchParams.set("projectKey", params.projectKey);
  if (params.jql) searchParams.set("jql", params.jql);
  if (params.q) searchParams.set("q", params.q);
  if (params.startAt !== undefined)
    searchParams.set("startAt", String(params.startAt));
  if (params.maxResults !== undefined)
    searchParams.set("maxResults", String(params.maxResults));

  return useQuery({
    queryKey: ["issues", params],
    queryFn: async () => {
      const res = await fetch(`/api/issues?${searchParams}`);
      if (!res.ok) throw new Error("Failed to fetch issues");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useIssue(issueKey: string | undefined) {
  return useQuery({
    queryKey: ["issue", issueKey],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueKey}`);
      if (!res.ok) throw new Error("Failed to fetch issue");
      return res.json();
    },
    enabled: !!issueKey,
    staleTime: 30_000,
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
