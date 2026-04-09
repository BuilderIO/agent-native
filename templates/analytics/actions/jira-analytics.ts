import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAnalytics } from "../server/lib/jira";

export default defineAction({
  description: "Get Jira sprint analytics: velocity, throughput, etc.",
  schema: z.object({
    projects: z.string().optional().describe("Comma-separated project keys"),
    days: z.coerce.number().optional().describe("Number of days (default 30)"),
  }),
  http: false,
  run: async (args) => {
    const projects = args.projects
      ? args.projects.split(",").map((p) => p.trim())
      : [];
    const days = args.days ?? 30;
    return await getAnalytics(projects, days);
  },
});
