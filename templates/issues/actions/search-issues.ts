import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraSearchIssues } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Search Jira issues via JQL or text",
  schema: z.object({
    jql: z.string().optional().describe("JQL query"),
    q: z.string().optional().describe("Free-text search"),
    compact: z.coerce.boolean().optional().describe("Compact output"),
    maxResults: z.coerce.number().optional().describe("Max results"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { jql, q, compact, maxResults } = args;

    if (!jql && !q) throw new Error("jql or q is required");

    const client = await getClient(getRequestUserEmail());
    if (!client) throw new Error("Jira not connected");

    const query = jql || `text ~ "${q!.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" ORDER BY updated DESC`;

    return await jiraSearchIssues(client.cloudId, client.accessToken, {
      jql: query,
      maxResults: maxResults || 25,
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
