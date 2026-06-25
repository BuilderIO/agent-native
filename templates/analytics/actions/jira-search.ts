import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { searchIssues } from "../server/lib/jira";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Search Jira issues using JQL. Use this first when the user asks to search Jira tickets, issues, bugs, or project work. Do not use BigQuery for Jira data unless the user explicitly asks for a warehouse copy.",
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
    const credentials = await requireActionCredentials(
      ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
      "Jira",
    );
    if (credentials.ok === false) return credentials.response;

    if (!args.jql) return { error: "jql is required" };

    try {
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
    } catch (err) {
      return providerError(err);
    }
  },
});
