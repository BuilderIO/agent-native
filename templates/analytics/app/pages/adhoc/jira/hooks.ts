import { useQuery } from "@tanstack/react-query";
import { getIdToken } from "@/lib/auth";

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

// -- Types --

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraStatus {
  name: string;
  statusCategory: { key: string; name: string };
}

export interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    status: JiraStatus;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    priority: { name: string; iconUrl?: string };
    issuetype: { name: string; iconUrl?: string };
    project: { key: string; name: string };
    created: string;
    updated: string;
    resolutiondate: string | null;
    labels: string[];
    [key: string]: unknown;
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  location?: { projectKey: string; name: string };
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

export interface JiraAnalytics {
  totalOpen: number;
  createdInPeriod: number;
  resolvedInPeriod: number;
  byStatus: Record<string, number>;
  byAssignee: { name: string; count: number }[];
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  createdByDay: { date: string; count: number }[];
  resolvedByDay: { date: string; count: number }[];
}

// -- Hooks --

export function useJiraProjects() {
  return useQuery<JiraProject[]>({
    queryKey: ["jira-projects"],
    queryFn: async () => {
      const data = await apiFetch<{ projects: JiraProject[] }>(
        "/api/jira/projects",
      );
      return data.projects;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useJiraSearch(jql: string, enabled = true) {
  return useQuery<{ issues: JiraIssue[]; total: number }>({
    queryKey: ["jira-search", jql],
    queryFn: () =>
      apiFetch(`/api/jira/search?jql=${encodeURIComponent(jql)}&maxResults=50`),
    enabled: enabled && jql.length > 0,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}

export function useJiraIssue(key: string | null) {
  return useQuery<{ issue: JiraIssue }>({
    queryKey: ["jira-issue", key],
    queryFn: () => apiFetch(`/api/jira/issue?key=${key}`),
    enabled: !!key,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}

export function useJiraAnalytics(projects: string[], days: number) {
  const projectsParam = projects.join(",");
  return useQuery<JiraAnalytics>({
    queryKey: ["jira-analytics", projectsParam, days],
    queryFn: () =>
      apiFetch(
        `/api/jira/analytics?projects=${encodeURIComponent(projectsParam)}&days=${days}`,
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useJiraBoards() {
  return useQuery<JiraBoard[]>({
    queryKey: ["jira-boards"],
    queryFn: async () => {
      const data = await apiFetch<{ boards: JiraBoard[] }>("/api/jira/boards");
      return data.boards;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useJiraSprints(boardId: number | null) {
  return useQuery<JiraSprint[]>({
    queryKey: ["jira-sprints", boardId],
    queryFn: async () => {
      const data = await apiFetch<{ sprints: JiraSprint[] }>(
        `/api/jira/sprints?boardId=${boardId}`,
      );
      return data.sprints;
    },
    enabled: !!boardId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
