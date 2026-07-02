import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listDispatchUsageMetricsScoped } from "../server/lib/usage-metrics.js";

export default defineAction({
  description:
    "Get workspace-level LLM usage, spend or Builder.io credit spend, users, app access, and recent activity metrics for Dispatch admins.",
  schema: z.object({
    sinceDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback window in days. Defaults to 30."),
  }),
  http: { method: "GET" },
  run: async (args) => listDispatchUsageMetricsScoped(args),
});
