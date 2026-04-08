import { defineAction } from "@agent-native/core";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraSearchIssues } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Search Jira issues via JQL or text",
  parameters: {
    jql: { type: "string", description: "JQL query" },
    q: { type: "string", description: "Free-text search" },
    compact: { type: "string", description: "Compact output (true/false)" },
    maxResults: { type: "string", description: "Max results" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const { jql, q, compact, maxResults } = args;

    if (!jql && !q) throw new Error("jql or q is required");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    const query = jql || `text ~ "${q}" ORDER BY updated DESC`;

    return await jiraSearchIssues(client.cloudId, client.accessToken, {
      jql: query,
      maxResults: Number(maxResults) || 25,
      fields: [
        "summary",
        "status",
        "priority",
        "assignee",
        "issuetype",
        "project",
      ],
    });
  },
});
