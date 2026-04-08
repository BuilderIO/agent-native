import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraSearchIssues } from "../server/lib/jira-api.js";

const DEFAULT_FIELDS = [
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
  "resolution",
  "resolutiondate",
  "parent",
  "subtasks",
  "issuelinks",
  "sprint",
  "comment",
];

export default defineAction({
  description: "List Jira issues for a view",
  parameters: {
    view: {
      type: "string",
      description: "View: my-issues (default), project, recent",
    },
    projectKey: {
      type: "string",
      description: "Project key (for project view)",
    },
    jql: { type: "string", description: "Custom JQL query" },
    q: { type: "string", description: "Text search" },
    nextPageToken: { type: "string", description: "Pagination token" },
    maxResults: { type: "string", description: "Max results (default 50)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { view, projectKey, q, nextPageToken, maxResults } = args;
    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    let jql = args.jql;

    if (!jql) {
      const v = view || "my-issues";
      switch (v) {
        case "my-issues":
          jql =
            "assignee = currentUser() AND resolution = Unresolved ORDER BY status ASC, updated DESC";
          break;
        case "project":
          if (!projectKey)
            throw new Error("projectKey is required for project view");
          jql = `project = "${projectKey}" ORDER BY updated DESC`;
          break;
        case "recent":
          jql = "assignee = currentUser() ORDER BY updated DESC";
          break;
        default:
          jql =
            "assignee = currentUser() AND resolution = Unresolved ORDER BY status ASC, updated DESC";
      }

      if (q) {
        const base = jql.split("ORDER BY")[0].trim();
        const order = jql.split("ORDER BY")[1]?.trim() || "updated DESC";
        jql = `text ~ "${q}" AND (${base}) ORDER BY ${order}`;
      }
    }

    return await jiraSearchIssues(client.cloudId, client.accessToken, {
      jql,
      nextPageToken,
      maxResults: Number(maxResults) || 50,
      fields: DEFAULT_FIELDS,
    });
  },
});
