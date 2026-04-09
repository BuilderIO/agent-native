import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraUpdateIssue } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Update fields on a Jira issue",
  schema: z.object({
    key: z.string().optional().describe("Issue key"),
    summary: z.string().optional().describe("New summary"),
    description: z.string().optional().describe("New description"),
    priority: z.string().optional().describe("New priority"),
    assignee: z.string().optional().describe("New assignee account ID"),
    labels: z.string().optional().describe("Comma-separated labels"),
  }),
  run: async (args: Record<string, any>) => {
    const { key, summary, description, priority, assignee, labels } = args;

    if (!key) throw new Error("key is required (e.g. --key=PROJ-123)");

    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    // If a raw Jira body is passed (from frontend), forward it directly
    if (args.fields) {
      await jiraUpdateIssue(client.cloudId, client.accessToken, key, {
        fields: args.fields,
      });
      return { success: true };
    }

    // Otherwise build from flat params (agent path)
    const fields: Record<string, unknown> = {};
    if (summary) fields.summary = summary;
    if (priority) fields.priority = { name: priority };
    if (assignee) fields.assignee = { accountId: assignee };
    if (labels) {
      const labelStr = typeof labels === "string" ? labels : String(labels);
      fields.labels = labelStr.split(",").map((l: string) => l.trim());
    }
    if (description) {
      fields.description = {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: description }],
          },
        ],
      };
    }

    if (Object.keys(fields).length === 0) {
      throw new Error(
        "provide at least one field to update (--summary, --description, --priority, --assignee, --labels)",
      );
    }

    await jiraUpdateIssue(client.cloudId, client.accessToken, key, { fields });
    return { success: true };
  },
});
