import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listDispatchUsageMetrics } from "../server/lib/usage-metrics-store.js";

export default defineAction({
  description:
    "Get personal, workspace, or owner-authorized app adoption metrics for Dispatch, including LLM usage, spend or Builder.io credit spend, active users, tracked app actions, app attribution, prompt previews, and recent activity. Workspace results also include monthlyByUser credit rows and workspaceAppCreationsByUserMonth rows from the shared token_usage and Dispatch audit tables. App scope is aggregate-only and returns daily/weekly active users plus tracked action counts for the selected app.",
  schema: z.object({
    sinceDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback window in days. Defaults to 30."),
    scope: z
      .enum(["me", "workspace", "app"])
      .default("workspace")
      .describe(
        "Whether to inspect your account, the whole workspace, or one app's aggregate adoption.",
      ),
    userEmail: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional workspace member email to filter all usage to."),
    appId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Workspace app id for scope=app. The app owner or an organization owner/admin can view its aggregate adoption.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    isConsequential: false,
  },
  run: async (args) => listDispatchUsageMetrics(args),
});
