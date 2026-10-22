import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listDispatchUsageMetrics } from "../server/lib/usage-metrics-store.js";

export default defineAction({
  description:
    "Reports agent/LLM usage and spend for members of this organization (personal or workspace-wide) plus aggregate app adoption for Dispatch; it does NOT cover usage, credits, or activity of external customers, accounts, companies, or product usage, use this app's own customer or billing actions for those, or the app that owns that data (see <relevant-apps>, or search with describe-workspace-apps). Results may include active users, tracked app actions, app attribution, prompt previews, and recent activity. billing.unit is unknown when historical usage lacks engine metadata or mixes billing sources; monthlyByUser credits are null in that case. Workspace results also include monthlyByUser credit rows and workspaceAppCreationsByUserMonth rows from the shared token_usage and Dispatch audit tables. App scope is aggregate-only and returns daily/weekly active users plus tracked action counts for the selected app.",
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
      .describe(
        "Optional email of a member of this organization to filter all usage to. Not for customers or other external accounts.",
      ),
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
