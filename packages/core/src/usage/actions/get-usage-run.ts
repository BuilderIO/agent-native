import { z } from "zod";

import { defineAction } from "../../action.js";
import { getUsageRun } from "../insights-store.js";
import { resolveUsageAppKey } from "../store.js";

export default defineAction({
  description:
    "Get one prompt's step-by-step cost breakdown for the Usage page: every LLM call with tokens, cache hit and cost, every tool call with status, cache misses with their likely cause, and automated eval scores.",
  http: { method: "GET" },
  schema: z.object({
    runId: z.string().trim().min(1).max(200),
    scope: z.enum(["me", "workspace"]).default("me"),
    userEmail: z.string().trim().min(1).optional(),
    appId: z.string().trim().max(200).optional(),
  }),
  run: async ({ runId, scope, userEmail, appId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return getUsageRun(
      { runId, scope, userEmail },
      {
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        app: resolveUsageAppKey(appId),
      },
    );
  },
});
