import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listDispatchUsageMetrics } from "../server/lib/usage-metrics-store.js";

export default defineAction({
  description:
    "Get personal or workspace LLM usage, spend or Builder.io credit spend, app attribution, prompt previews, and recent activity metrics for Dispatch.",
  schema: z.object({
    sinceDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback window in days. Defaults to 30."),
    scope: z
      .enum(["me", "workspace"])
      .default("workspace")
      .describe("Whether to inspect your account or the whole workspace."),
    userEmail: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional workspace member email to filter all usage to."),
  }),
  http: { method: "GET" },
  run: async (args) => listDispatchUsageMetrics(args),
});
