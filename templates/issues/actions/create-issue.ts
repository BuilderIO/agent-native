import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getClient } from "../server/lib/jira-auth.js";
import { jiraCreateIssue } from "../server/lib/jira-api.js";

export default defineAction({
  description: "Create a new Jira issue",
  schema: z.object({
    project: z.string().optional().describe("Project key"),
    type: z.string().optional().describe("Issue type: Task, Bug, Story, Epic"),
    summary: z.string().optional().describe("Issue summary/title"),
    description: z.string().optional().describe("Issue description"),
    priority: z
      .string()
      .optional()
      .describe("Priority: Highest, High, Medium, Low, Lowest"),
    assignee: z.string().optional().describe("Assignee account ID"),
  }),
  run: async (args: Record<string, any>) => {
    const client = await getClient(process.env.AGENT_USER_EMAIL);
    if (!client) throw new Error("Jira not connected");

    // If raw Jira body with `fields` is passed (from frontend), forward directly
    if (args.fields) {
      return await jiraCreateIssue(client.cloudId, client.accessToken, {
        fields: args.fields,
      });
    }

    // Otherwise build from flat params (agent path)
    const { project, type, summary, description, priority, assignee } = args;

    if (!project) throw new Error("project is required (project key)");
    if (!summary) throw new Error("summary is required");

    const fields: Record<string, unknown> = {
      project: { key: project },
      summary,
      issuetype: { name: type || "Task" },
    };

    if (priority) fields.priority = { name: priority };
    if (assignee) fields.assignee = { accountId: assignee };
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

    return await jiraCreateIssue(client.cloudId, client.accessToken, {
      fields,
    });
  },
});
