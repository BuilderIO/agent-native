import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraGetIssue } from "../server/lib/jira-api.js";

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
  "description",
  "comment",
  "subtasks",
  "issuelinks",
  "sprint",
  "parent",
  "resolution",
  "resolutiondate",
];

export default defineAction({
  description: "Get full details of a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key (e.g. PROJ-123)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const { key } = args;
    if (!key) throw new Error("key is required (e.g. --key=PROJ-123)");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    return await jiraGetIssue(client.cloudId, client.accessToken, key, {
      fields: DEFAULT_FIELDS,
      expand: ["changelog", "renderedFields"],
    });
  },
});
