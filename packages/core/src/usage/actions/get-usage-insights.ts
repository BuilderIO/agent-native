import { z } from "zod";

import { defineAction } from "../../action.js";
import { getUsageInsights } from "../insights-store.js";
import { resolveUsageAppKey } from "../store.js";

export default defineAction({
  description:
    "Get the Usage page's performance breakdown for an app: spend split by cache reads, cache writes, fresh input and output, savings versus no prompt caching, and recent prompts with per-run LLM calls, tool calls, tool lookups and cache misses.",
  http: { method: "GET" },
  schema: z.object({
    sinceDays: z.coerce.number().int().min(1).max(365).default(30),
    scope: z.enum(["me", "workspace"]).default("me"),
    userEmail: z.string().trim().min(1).optional(),
    appId: z.string().trim().max(200).optional(),
  }),
  run: async ({ sinceDays, scope, userEmail, appId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return getUsageInsights(
      { sinceDays, scope, userEmail },
      {
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        app: resolveUsageAppKey(appId),
      },
    );
  },
});
