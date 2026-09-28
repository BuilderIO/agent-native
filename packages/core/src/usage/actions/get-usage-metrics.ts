import { z } from "zod";

import { defineAction } from "../../action.js";
import { BUILDER_CREDIT_USAGE_REPORTING_FLAG } from "../../feature-flags/registry.js";
import { isFeatureFlagEnabled } from "../../feature-flags/store.js";
import {
  ALL_USAGE_APPS,
  listAppUsageMetrics,
  USAGE_APP_FILTER_ALL,
  USAGE_APP_FILTER_CURRENT,
  type UsageAppSelection,
} from "../metrics-store.js";
import { resolveUsageAppKey } from "../store.js";

function resolveAppSelection(
  app: string | undefined,
  appId: string | undefined,
): UsageAppSelection {
  if (appId !== undefined) {
    if (app !== undefined) {
      throw new Error("Pass app or appId, not both.");
    }
    return resolveUsageAppKey(appId);
  }
  if (app === undefined || app === USAGE_APP_FILTER_ALL) return ALL_USAGE_APPS;
  if (app === USAGE_APP_FILTER_CURRENT) return resolveUsageAppKey();
  return app;
}

export default defineAction({
  description:
    'Get LLM usage metrics for Settings › Usage: lookback totals, the daily trend split by feature, app, model and surface (dailyBy), top features, models, apps, chats and people, tool calls per day, recent prompts, and the apps with usage. Covers every app unless app names one. Members see only their own usage; scope "workspace" (everyone in the organization) is for owners and admins. billing.unit says whether amounts read as Builder.io credits or estimated dollars.',
  http: { method: "GET" },
  schema: z.object({
    sinceDays: z.coerce.number().int().min(1).max(365).default(30),
    scope: z.enum(["me", "workspace"]).default("me"),
    userEmail: z.string().trim().min(1).optional(),
    app: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        '"all" (the default) for every app, "current" for the app serving this request, or an app key from a previous result\'s apps list.',
      ),
    appId: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Deprecated: use app. Filters to this one app."),
  }),
  run: async ({ sinceDays, scope, userEmail, app, appId }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const selection = resolveAppSelection(app, appId);
    const builderCreditsEnabled = await isFeatureFlagEnabled(
      BUILDER_CREDIT_USAGE_REPORTING_FLAG,
      { userEmail: ctx.userEmail, orgId: ctx.orgId },
    );
    const metrics = await listAppUsageMetrics(
      { sinceDays, scope, userEmail, builderCreditsEnabled },
      {
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        app: selection,
      },
    );
    return { ...metrics, builderCreditUsageEnabled: builderCreditsEnabled };
  },
});
