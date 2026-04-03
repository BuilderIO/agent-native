/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching issue data via the Jira API.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { readAppState } from "@agent-native/core/application-state";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view, issue list, and open issue details (if any). Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

const FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "reporter",
  "issuetype",
  "project",
  "labels",
  "created",
  "updated",
  "sprint",
  "comment",
  "subtasks",
];

async function fetchIssueList(
  nav: Record<string, string>,
  accessToken: string,
  cloudId: string,
): Promise<any[] | null> {
  try {
    let jql: string;
    const view = nav.view || "my-issues";

    switch (view) {
      case "my-issues":
        jql =
          "assignee = currentUser() AND resolution = Unresolved ORDER BY status ASC, updated DESC";
        break;
      case "projects":
        if (nav.projectKey) {
          jql = `project = "${nav.projectKey}" ORDER BY updated DESC`;
        } else {
          return null; // projects listing, no issue list
        }
        break;
      case "board":
      case "sprint":
        if (nav.projectKey) {
          jql = `project = "${nav.projectKey}" ORDER BY updated DESC`;
        } else {
          jql =
            "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
        }
        break;
      default:
        jql =
          "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
    }

    if (nav.search) {
      const base = jql.split("ORDER BY")[0].trim();
      const order = jql.split("ORDER BY")[1]?.trim() || "updated DESC";
      jql = `text ~ "${nav.search}" AND (${base}) ORDER BY ${order}`;
    }

    const result = await jiraFetch(
      jiraUrl(cloudId, "/search/jql"),
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          jql,
          maxResults: 50,
          fields: FIELDS,
        }),
      },
    );

    return result.issues || [];
  } catch {
    return null;
  }
}

async function fetchIssueDetail(
  issueKey: string,
  accessToken: string,
  cloudId: string,
): Promise<any | null> {
  try {
    return await jiraFetch(
      jiraUrl(cloudId, `/issue/${issueKey}?fields=${FIELDS.join(",")}`),
      accessToken,
    );
  } catch {
    return null;
  }
}

export async function run(): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = (navigation || {}) as Record<string, string>;

  // Try to get Jira client for API calls
  let client: { accessToken: string; cloudId: string } | null = null;
  try {
    client = await getAtlassianClient();
  } catch {
    // Jira not connected — still return navigation state
  }

  if (client) {
    // Fetch the issue list for the current view
    if (nav.view && nav.view !== "settings") {
      const issues = await fetchIssueList(
        nav,
        client.accessToken,
        client.cloudId,
      );
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
      const issue = await fetchIssueDetail(
        nav.issueKey,
        client.accessToken,
        client.cloudId,
      );
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
  } else if (nav.view) {
    screen.jiraStatus = "Not connected. Ask the user to connect via Settings.";
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
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}
