import { defineAction } from "@agent-native/core";
import { getAnalytics } from "../server/lib/jira";

export default defineAction({
  description: "Get Jira sprint analytics: velocity, throughput, etc.",
  parameters: {
    projects: {
      type: "string",
      description: "Comma-separated project keys",
    },
    days: { type: "string", description: "Number of days (default 30)" },
  },
  http: false,
  run: async (args) => {
    const projects = args.projects
      ? args.projects.split(",").map((p) => p.trim())
      : [];
    const days = parseInt(args.days ?? "30");
    return await getAnalytics(projects, days);
  },
});
