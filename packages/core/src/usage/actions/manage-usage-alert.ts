import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  dismissUsageAlert,
  saveUsageAlert,
  setUsageAlertEnabled,
  type UsageAlertChannel,
  type UsageAlertPeriod,
  type UsageAlertScope,
  type UsageAlertUnit,
} from "../alerts-store.js";

const channel = z.enum(["in-app", "email"]);

export default defineAction({
  description:
    "Create or edit an LLM usage alert, enable or disable it, or dismiss the current alert event. Alerts can be scoped to the current user or active organization and filtered to an app.",
  schema: z.object({
    operation: z.enum(["save", "set-enabled", "dismiss"]),
    scope: z.enum(["user", "workspace"]).default("user"),
    ruleId: z.string().trim().max(200).optional(),
    appId: z.string().trim().max(200).nullable().optional(),
    unit: z.enum(["usd", "builder-credits", "tokens"]).optional(),
    period: z.enum(["day", "month"]).optional(),
    /** Display units: dollars, Builder credits, or raw tokens. */
    limit: z.number().finite().positive().max(9_000_000_000_000).optional(),
    channels: z.array(channel).min(1).optional(),
    enabled: z.boolean().optional(),
  }),
  run: async (
    { operation, scope, ruleId, appId, unit, period, limit, channels, enabled },
    ctx,
  ) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const access = { ownerEmail: ctx.userEmail, orgId: ctx.orgId };
    const alertScope = scope as UsageAlertScope;

    if (operation === "dismiss") {
      if (!ruleId) throw new Error("ruleId is required to dismiss an alert.");
      return {
        dismissed: await dismissUsageAlert(ruleId, alertScope, access),
      };
    }

    if (operation === "set-enabled") {
      if (!ruleId || enabled === undefined) {
        throw new Error("ruleId and enabled are required to change an alert.");
      }
      return setUsageAlertEnabled(ruleId, alertScope, enabled, access);
    }

    return saveUsageAlert(
      {
        scope: alertScope,
        ruleId,
        appId,
        unit: unit as UsageAlertUnit | undefined,
        period: period as UsageAlertPeriod | undefined,
        limit,
        channels: channels as UsageAlertChannel[] | undefined,
        enabled,
      },
      access,
    );
  },
});
