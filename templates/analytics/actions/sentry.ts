import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getIssueEvents,
  getOrganizationStats,
  listIssues,
  listProjects,
} from "../server/lib/sentry";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  description:
    "Query Sentry projects, frequent issues, issue events, and organization error stats. Use this for Sentry error questions; pass statsPeriod like 7d, 30d, or 1y.",
  schema: z.object({
    mode: z
      .enum(["projects", "issues", "issue-events", "stats"])
      .default("issues")
      .describe("What to query from Sentry"),
    orgSlug: z
      .string()
      .optional()
      .describe("Sentry organization slug; defaults to the configured org"),
    project: z.string().optional().describe("Optional Sentry project slug"),
    query: z.string().optional().describe("Sentry issue search query"),
    statsPeriod: z
      .string()
      .optional()
      .describe("Sentry stats period, e.g. 7d, 30d, 1y"),
    issueId: z
      .string()
      .optional()
      .describe("Sentry issue ID for mode=issue-events"),
    category: z
      .string()
      .optional()
      .describe("Sentry stats category for mode=stats; defaults to error"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["SENTRY_SERVER_TOKEN", "SENTRY_AUTH_TOKEN"],
      "Sentry",
      {
        mode: "any",
        message:
          "Sentry is not connected for this workspace yet. Add SENTRY_AUTH_TOKEN in Settings -> Data sources, then retry.",
      },
    );
    if (!credentials.ok) return credentials.response;

    try {
      if (args.mode === "projects") {
        const projects = await listProjects(args.orgSlug);
        return { projects, total: projects.length };
      }

      if (args.mode === "issue-events") {
        if (!args.issueId) return { error: "issueId is required" };
        const events = await getIssueEvents(args.issueId, args.orgSlug);
        return { events, total: events.length };
      }

      if (args.mode === "stats") {
        return await getOrganizationStats(
          args.statsPeriod,
          args.category,
          args.orgSlug,
        );
      }

      const issues = await listIssues(
        args.project,
        args.query,
        args.statsPeriod,
        args.orgSlug,
      );
      return { issues, total: issues.length };
    } catch (err) {
      return providerError(err);
    }
  },
});
