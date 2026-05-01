import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getAnalytics,
  getBoards,
  getIssue,
  getProjects,
  getSprints,
  getStatuses,
  searchIssues,
} from "../server/lib/jira";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Query Jira issues, issue details, projects, statuses, boards, sprints, and sprint analytics.",
  schema: z.object({
    mode: z
      .enum([
        "search",
        "issue",
        "projects",
        "statuses",
        "boards",
        "sprints",
        "analytics",
      ])
      .default("search")
      .describe("What to query from Jira"),
    jql: z.string().optional().describe("JQL for mode=search"),
    key: z.string().optional().describe("Issue key for mode=issue"),
    fields: z
      .string()
      .optional()
      .describe("Comma-separated fields for mode=search"),
    maxResults: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Max search results"),
    project: z.string().optional().describe("Project key for mode=statuses"),
    boardId: z.coerce
      .number()
      .int()
      .optional()
      .describe("Board ID for mode=sprints"),
    projects: z
      .string()
      .optional()
      .describe("Comma-separated project keys for mode=analytics"),
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback days for mode=analytics"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
      "Jira",
    );
    if (credentials.ok === false) return credentials.response;

    try {
      if (args.mode === "issue") {
        if (!args.key) return { error: "key is required" };
        return { issue: await getIssue(args.key) };
      }

      if (args.mode === "projects") {
        const projects = await getProjects();
        return { projects, total: projects.length };
      }

      if (args.mode === "statuses") {
        const statuses = await getStatuses(args.project);
        return { statuses, total: statuses.length };
      }

      if (args.mode === "boards") {
        const boards = await getBoards();
        return { boards, total: boards.length };
      }

      if (args.mode === "sprints") {
        if (!args.boardId) return { error: "boardId is required" };
        const sprints = await getSprints(args.boardId);
        return { sprints, total: sprints.length };
      }

      if (args.mode === "analytics") {
        const projectKeys = args.projects
          ? args.projects.split(",").map((project) => project.trim())
          : [];
        return await getAnalytics(projectKeys, args.days);
      }

      if (!args.jql) return { error: "jql is required" };
      const fields = args.fields
        ? args.fields.split(",").map((field) => field.trim())
        : undefined;
      return await searchIssues(args.jql, fields, args.maxResults);
    } catch (err) {
      return providerError(err);
    }
  },
});
