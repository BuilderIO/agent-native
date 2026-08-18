import { z } from "zod";

import { defineAction } from "../../action.js";
import { listAppUsageMetrics } from "../metrics-store.js";

export default defineAction({
  description:
    "Get compact, app-scoped LLM usage metrics for Settings: lookback totals, daily spend trend, top drivers, recent prompts, and user filtering.",
  http: { method: "GET" },
  schema: z.object({
    sinceDays: z.coerce.number().int().min(1).max(365).default(30),
    scope: z.enum(["me", "workspace"]).default("me"),
    userEmail: z.string().trim().min(1).optional(),
    appId: z.string().trim().max(200).optional(),
  }),
  run: async ({ sinceDays, scope, userEmail, appId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return listAppUsageMetrics(
      { sinceDays, scope, userEmail },
      {
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        app:
          ctx.appId ??
          appId ??
          process.env.AGENT_APP ??
          process.env.APP_NAME ??
          "app",
      },
    );
  },
});
