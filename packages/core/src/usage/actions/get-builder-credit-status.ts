import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBuilderCreditUsage } from "../../server/fusion-app.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { clearBuilderCreditLimitNotice } from "../builder-credit-notice.js";
import { canViewWorkspaceUsage } from "../metrics-store.js";

export default defineAction({
  description:
    "Check the connected Builder account's active credit quota. Organization owners and admins also receive its balance and quota usage.",
  http: { method: "GET" },
  schema: z.object({ orgId: z.string().nullable().optional() }),
  run: async ({ orgId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const activeOrgId = getRequestOrgId() ?? null;
    if (orgId !== undefined && orgId !== activeOrgId) {
      throw new Error("The active organization changed. Please retry.");
    }

    const canViewWorkspace = await canViewWorkspaceUsage({
      ownerEmail: ctx.userEmail,
      orgId: activeOrgId,
    });
    const usage = await getBuilderCreditUsage();
    if (!usage) return null;

    const exhausted = usage.quota.remaining <= 0;
    if (!exhausted) {
      await clearBuilderCreditLimitNotice(ctx.userEmail, activeOrgId);
    }
    return {
      exhausted,
      period: usage.quota.period,
      ...(canViewWorkspace
        ? { balance: usage.balance, quota: usage.quota }
        : {}),
    };
  },
});
