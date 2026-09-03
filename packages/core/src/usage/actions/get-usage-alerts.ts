import { z } from "zod";

import { defineAction } from "../../action.js";
import { listUsageAlerts, type UsageAlertScope } from "../alerts-store.js";

export default defineAction({
  description:
    "List the current user's or active organization's LLM usage alert rules, including the current window, threshold status, delivery channels, and recent dismissal state.",
  http: { method: "GET" },
  schema: z.object({
    scope: z.enum(["user", "workspace"]).default("user"),
    appId: z.string().trim().max(200).nullable().optional(),
  }),
  run: async ({ scope, appId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return listUsageAlerts(
      { scope: scope as UsageAlertScope, appId },
      { ownerEmail: ctx.userEmail, orgId: ctx.orgId },
    );
  },
});
