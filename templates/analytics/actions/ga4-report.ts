import { defineAction } from "@agent-native/core";
import { runReport } from "../server/lib/google-analytics";

export default defineAction({
  description: "Query Google Analytics 4 report data.",
  parameters: {
    metrics: {
      type: "string",
      description:
        "Comma-separated metrics (required). E.g. activeUsers,sessions",
    },
    dimensions: {
      type: "string",
      description: "Comma-separated dimensions. E.g. date,source",
    },
    days: { type: "string", description: "Number of days (default 30)" },
  },
  http: false,
  run: async (args) => {
    if (!args.metrics) return { error: "metrics is required" };

    const metrics = args.metrics.split(",").map((m) => m.trim());
    const dimensions = args.dimensions
      ? args.dimensions.split(",").map((d) => d.trim())
      : [];
    const days = parseInt(args.days || "30", 10);

    return await runReport(dimensions, metrics, {
      startDate: `${days}daysAgo`,
      endDate: "today",
    });
  },
});
