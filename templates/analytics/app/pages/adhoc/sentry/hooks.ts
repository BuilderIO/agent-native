import { useQuery } from "@tanstack/react-query";
import { getIdToken } from "@/lib/auth";
import type {
  SentryProject,
  SentryIssue,
  SentryEvent,
  SentryOrgStats,
  TimePeriod,
} from "./types";

async function apiFetch<T>(path: string): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(path, {
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function useSentryProjects() {
  return useQuery<SentryProject[]>({
    queryKey: ["sentry-projects"],
    queryFn: async () => {
      const data = await apiFetch<{ projects: SentryProject[] }>(
        "/api/sentry/projects",
      );
      return data.projects;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useSentryIssues(
  project?: string,
  query?: string,
  period?: TimePeriod,
) {
  return useQuery<SentryIssue[]>({
    queryKey: ["sentry-issues", project, query, period],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (project) params.set("project", project);
      if (query) params.set("query", query);
      if (period) params.set("statsPeriod", period);
      const data = await apiFetch<{ issues: SentryIssue[] }>(
        `/api/sentry/issues?${params.toString()}`,
      );
      return data.issues;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useSentryIssueEvents(issueId: string | null) {
  return useQuery<SentryEvent[]>({
    queryKey: ["sentry-issue-events", issueId],
    queryFn: async () => {
      const data = await apiFetch<{ events: SentryEvent[] }>(
        `/api/sentry/issue-events?issueId=${issueId}`,
      );
      return data.events;
    },
    enabled: !!issueId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSentryStats(period: TimePeriod) {
  return useQuery<SentryOrgStats>({
    queryKey: ["sentry-stats", period],
    queryFn: () =>
      apiFetch<SentryOrgStats>(
        `/api/sentry/stats?statsPeriod=${period}&category=error`,
      ),
    staleTime: 2 * 60 * 1000,
  });
}
