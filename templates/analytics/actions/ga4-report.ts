import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runReport } from "../server/lib/google-analytics";

export default defineAction({
  description: "Query Google Analytics 4 report data.",
  schema: z.object({
    metrics: z
      .string()
      .optional()
      .describe(
        "Comma-separated metrics (required). E.g. activeUsers,sessions",
      ),
    dimensions: z
      .string()
      .optional()
      .describe("Comma-separated dimensions. E.g. date,source"),
    days: z.coerce.number().optional().describe("Number of days (default 30)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.metrics) return { error: "metrics is required" };

    const metrics = args.metrics.split(",").map((m) => m.trim());
    const dimensions = args.dimensions
      ? args.dimensions.split(",").map((d) => d.trim())
      : [];
    const days = args.days ?? 30;

    return await runReport(dimensions, metrics, {
      startDate: `${days}daysAgo`,
      endDate: "today",
    });
  },
});
