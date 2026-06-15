import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAnalytics } from "../server/lib/jira";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Get Jira sprint analytics: velocity, throughput, and related project tracking metrics. Use this first for Jira sprint, board, velocity, throughput, or project-tracking analytics. Do not use BigQuery for Jira data unless the user explicitly asks for a warehouse copy.",
  schema: z.object({
    projects: z.string().optional().describe("Comma-separated project keys"),
    days: z.coerce.number().optional().describe("Number of days (default 30)"),
  }),
  http: false,
  run: async (args) => {
    const credentials = await requireActionCredentials(
      ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"],
      "Jira",
    );
    if (credentials.ok === false) return credentials.response;

    try {
      const projects = args.projects
        ? args.projects.split(",").map((p) => p.trim())
        : [];
      const days = args.days ?? 30;
      return await getAnalytics(projects, days);
    } catch (err) {
      return providerError(err);
    }
  },
});
