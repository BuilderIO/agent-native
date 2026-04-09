import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { searchIssues } from "../server/lib/jira";

export default defineAction({
  description: "Search Jira issues using JQL.",
  schema: z.object({
    jql: z.string().optional().describe("JQL query (required)"),
    maxResults: z.coerce
      .number()
      .optional()
      .describe("Max results (default 50)"),
    fields: z
      .string()
      .optional()
      .describe("Comma-separated field names to include"),
  }),
  http: false,
  run: async (args) => {
    if (!args.jql) return { error: "jql is required" };

    const maxResults = args.maxResults ?? 50;
    const fields = args.fields
      ? args.fields.split(",").map((f) => f.trim())
      : undefined;

    const result = await searchIssues(args.jql, fields, maxResults);

    const simplified = result.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      statusCategory: issue.fields.status?.statusCategory?.key,
      priority: issue.fields.priority?.name,
      assignee: issue.fields.assignee?.displayName ?? "Unassigned",
      reporter: issue.fields.reporter?.displayName,
      type: issue.fields.issuetype?.name,
      project: issue.fields.project?.key,
      created: issue.fields.created,
      updated: issue.fields.updated,
      resolved: issue.fields.resolutiondate,
      labels: issue.fields.labels,
    }));

    return { issues: simplified, total: result.total };
  },
});
