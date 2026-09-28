import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBuilderCreditUsage } from "../../server/fusion-app.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { clearBuilderCreditLimitNotice } from "../builder-credit-notice.js";

export default defineAction({
  description:
    "Check whether the connected Builder account has run out of credits. Returns only the exhausted status, without exposing usage details.",
  http: { method: "GET" },
  schema: z.object({ orgId: z.string().nullable().optional() }),
  run: async ({ orgId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    if (orgId !== undefined && orgId !== (getRequestOrgId() ?? null)) {
      throw new Error("The active organization changed. Please retry.");
    }

    const usage = await getBuilderCreditUsage();
    if (!usage) return null;

    const exhausted = usage.balance <= 0 || usage.quota.remaining <= 0;
    if (!exhausted) {
      await clearBuilderCreditLimitNotice(ctx.userEmail, getRequestOrgId());
    }
    return { exhausted };
  },
});
