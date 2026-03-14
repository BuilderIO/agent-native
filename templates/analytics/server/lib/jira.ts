// Jira Cloud REST API client
// Uses Basic auth (email + API token)

const API_V3 = "/rest/api/3";
const API_AGILE = "/rest/agile/1.0";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 100;

function getAuth(): { baseUrl: string; headers: Record<string, string> } {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_USER_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    throw new Error(
      "JIRA_BASE_URL, JIRA_USER_EMAIL, and JIRA_API_TOKEN env vars are required",
    );
  }
  const encoded = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    headers: {
      Authorization: `Basic ${encoded}`,
      Accept: "application/json",
    },
  };
}

async function jiraGet<T>(
  path: string,
  params?: Record<string, string>,
  cacheKey?: string,
): Promise<T> {
  const key =
    cacheKey ??
    path + (params ? "?" + new URLSearchParams(params).toString() : "");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const { baseUrl, headers } = getAuth();
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
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
  statusCategory: {
    key: string; // "new" | "indeterminate" | "done"
    name: string;
  };
}

export interface JiraPriority {
  name: string;
  iconUrl?: string;
}

export interface JiraIssueType {
  name: string;
  iconUrl?: string;
}

export interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    status: JiraStatus;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    priority: JiraPriority;
    issuetype: JiraIssueType;
    project: { key: string; name: string };
    created: string;
    updated: string;
    resolutiondate: string | null;
    description?: unknown;
    labels: string[];
    [key: string]: unknown;
  };
}

interface SearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string; // "active" | "closed" | "future"
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  location?: { projectKey: string; name: string };
}

// -- API functions --

const DEFAULT_FIELDS = [
  "summary",
  "status",
  "assignee",
  "reporter",
  "priority",
  "issuetype",
  "project",
  "created",
  "updated",
  "resolutiondate",
  "labels",
];

export async function searchIssues(
  jql: string,
  fields?: string[],
  maxResults = 50,
): Promise<{ issues: JiraIssue[]; total: number }> {
  const params: Record<string, string> = {
    jql,
    fields: (fields ?? DEFAULT_FIELDS).join(","),
    maxResults: String(maxResults),
  };
  const data = await jiraGet<SearchResponse>(`${API_V3}/search/jql`, params);
  return { issues: data.issues, total: data.total };
}

export async function getIssue(issueKey: string): Promise<JiraIssue> {
  return jiraGet<JiraIssue>(`${API_V3}/issue/${issueKey}`);
}

export async function getProjects(): Promise<JiraProject[]> {
  return jiraGet<JiraProject[]>(`${API_V3}/project`);
}

export async function getStatuses(
  projectKey?: string,
): Promise<{ name: string; statusCategory: { key: string; name: string } }[]> {
  if (projectKey) {
    const data = await jiraGet<
      {
        statuses: {
          name: string;
          statusCategory: { key: string; name: string };
        }[];
      }[]
    >(`${API_V3}/project/${projectKey}/statuses`);
    const all = data.flatMap((issueType) => issueType.statuses);
    const unique = new Map(all.map((s) => [s.name, s]));
    return [...unique.values()];
  }
  return jiraGet(`${API_V3}/status`);
}

export async function getBoards(): Promise<JiraBoard[]> {
  const data = await jiraGet<{ values: JiraBoard[] }>(`${API_AGILE}/board`);
  return data.values;
}

export async function getSprints(boardId: number): Promise<JiraSprint[]> {
  const data = await jiraGet<{ values: JiraSprint[] }>(
    `${API_AGILE}/board/${boardId}/sprint`,
  );
  return data.values;
}

// -- Analytics helpers --

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

export async function getAnalytics(
  projects: string[],
  days = 30,
): Promise<JiraAnalytics> {
  const sinceDate = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  const projectJql = projects.length
    ? `project IN (${projects.join(",")}) AND `
    : "";

  // Fetch open issues
  const openResult = await searchIssues(
    `${projectJql}statusCategory != Done`,
    DEFAULT_FIELDS,
    200,
  );

  // Fetch recently created
  const createdResult = await searchIssues(
    `${projectJql}created >= "${sinceDate}"`,
    [...DEFAULT_FIELDS, "resolutiondate"],
    200,
  );

  // Fetch recently resolved
  const resolvedResult = await searchIssues(
    `${projectJql}resolved >= "${sinceDate}"`,
    [...DEFAULT_FIELDS, "resolutiondate"],
    200,
  );

  // Aggregate
  const byStatus: Record<string, number> = {};
  const assigneeCounts: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const issue of openResult.issues) {
    const status = issue.fields.status.name;
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const assignee = issue.fields.assignee?.displayName ?? "Unassigned";
    assigneeCounts[assignee] = (assigneeCounts[assignee] ?? 0) + 1;

    const priority = issue.fields.priority?.name ?? "None";
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;

    const type = issue.fields.issuetype?.name ?? "Unknown";
    byType[type] = (byType[type] ?? 0) + 1;
  }

  const byAssignee = Object.entries(assigneeCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Created by day
  const createdByDayMap: Record<string, number> = {};
  for (const issue of createdResult.issues) {
    const day = issue.fields.created.slice(0, 10);
    createdByDayMap[day] = (createdByDayMap[day] ?? 0) + 1;
  }

  // Resolved by day
  const resolvedByDayMap: Record<string, number> = {};
  for (const issue of resolvedResult.issues) {
    const day = issue.fields.resolutiondate?.slice(0, 10);
    if (day) {
      resolvedByDayMap[day] = (resolvedByDayMap[day] ?? 0) + 1;
    }
  }

  // Fill missing days
  const allDays: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    allDays.push(
      new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
    );
  }

  const createdByDay = allDays.map((date) => ({
    date,
    count: createdByDayMap[date] ?? 0,
  }));
  const resolvedByDay = allDays.map((date) => ({
    date,
    count: resolvedByDayMap[date] ?? 0,
  }));

  return {
    totalOpen: openResult.total,
    createdInPeriod: createdResult.total,
    resolvedInPeriod: resolvedResult.total,
    byStatus,
    byAssignee,
    byPriority,
    byType,
    createdByDay,
    resolvedByDay,
  };
}
