/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching issue data via the Jira API.
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraSearchIssues, jiraGetIssue } from "../server/lib/jira-api.js";

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
          return null;
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

    const result = await jiraSearchIssues(cloudId, accessToken, {
      jql,
      maxResults: 50,
      fields: FIELDS,
    });

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
    return await jiraGetIssue(cloudId, accessToken, issueKey, {
      fields: FIELDS,
    });
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, issue list, and open issue details (if any). Always call this first before taking any action.",
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = (navigation || {}) as Record<string, string>;

    let client: { accessToken: string; cloudId: string } | null = null;
    try {
      client = await getClient(getRequestUserEmail());
    } catch {
      // Jira not connected
    }

    if (client) {
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
      screen.jiraStatus =
        "Not connected. Ask the user to connect via Settings.";
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. The UI may not be open.";
    }
    return JSON.stringify(screen, null, 2);
  },
});
