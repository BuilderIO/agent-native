/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching issue data via API.
 *
 * Usage:
 *   pnpm script view-screen
 */

import { parseArgs, output } from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view, issue list, and open issue details (if any). Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

async function localFetch<T>(path: string): Promise<T | null> {
  try {
    const port = process.env.PORT || "8080";
    const res = await fetch(`http://localhost:${port}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchIssueList(
  nav: Record<string, string>,
): Promise<any[] | null> {
  const params = new URLSearchParams();
  if (nav.view) params.set("view", nav.view);
  if (nav.projectKey) params.set("projectKey", nav.projectKey);
  if (nav.boardId) params.set("boardId", nav.boardId);
  if (nav.search) params.set("q", nav.search);
  return localFetch(`/api/issues?${params}`);
}

async function fetchIssueDetail(issueKey: string): Promise<any | null> {
  return localFetch(`/api/issues/${issueKey}`);
}

export async function run(): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = (navigation || {}) as Record<string, string>;

  // Fetch the issue list for the current view
  if (nav.view) {
    const issues = await fetchIssueList(nav);
    if (issues) {
      const compact = (Array.isArray(issues) ? issues : [])
        .slice(0, 50)
        .map((issue: any) => ({
          key: issue.key,
          summary: issue.fields?.summary,
          status: issue.fields?.status?.name,
          statusCategory: issue.fields?.status?.statusCategory?.key,
          priority: issue.fields?.priority?.name,
          assignee: issue.fields?.assignee?.displayName ?? "Unassigned",
          type: issue.fields?.issuetype?.name,
          updated: issue.fields?.updated,
        }));
      screen.issueList = {
        view: nav.view,
        projectKey: nav.projectKey ?? null,
        boardId: nav.boardId ?? null,
        count: compact.length,
        issues: compact,
      };
    }
  }

  // Fetch full issue detail if viewing a specific issue
  if (nav.issueKey) {
    const issue = await fetchIssueDetail(nav.issueKey);
    if (issue) {
      screen.issue = {
        key: issue.key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        statusCategory: issue.fields?.status?.statusCategory?.key,
        priority: issue.fields?.priority?.name,
        assignee: issue.fields?.assignee?.displayName ?? "Unassigned",
        reporter: issue.fields?.reporter?.displayName ?? "Unknown",
        type: issue.fields?.issuetype?.name,
        project: issue.fields?.project?.key,
        labels: issue.fields?.labels ?? [],
        created: issue.fields?.created,
        updated: issue.fields?.updated,
        sprint: issue.fields?.sprint?.name ?? null,
        commentCount: issue.fields?.comment?.total ?? 0,
        subtaskCount: issue.fields?.subtasks?.length ?? 0,
      };
    }
  }

  if (Object.keys(screen).length === 0) {
    return "No application state found. The UI may not be open.";
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(): Promise<void> {
  const result = await run();

  try {
    const parsed = JSON.parse(result);
    const nav = parsed.navigation;
    const issueCount = parsed.issueList?.count ?? 0;

    console.error(
      `Current view: ${nav?.view ?? "unknown"}` +
        (nav?.issueKey ? ` (issue: ${nav.issueKey})` : "") +
        ` — ${issueCount} issue(s) on screen`,
    );
    output(parsed);
  } catch {
    console.log(result);
  }
}
