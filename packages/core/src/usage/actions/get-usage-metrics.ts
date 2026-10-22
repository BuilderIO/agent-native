import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { isOrgMember } from "../../org/membership.js";
import {
  ALL_USAGE_APPS,
  canViewWorkspaceUsage,
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
    'Reports this workspace\'s own agent/LLM usage (Settings › Usage) for members of this organization only; it does NOT cover usage, credits, or activity of external customers, accounts, companies, or product usage, which belong to the app that owns that data (see <relevant-apps>, or search with describe-workspace-apps). Returns lookback totals, the daily trend (dailyBy feature, app, model and surface), top features, models, apps, chats and people, tool calls per day, and recent prompts, across every app unless app names one. Members see only their own usage; scope "workspace" (everyone in the organization) is for owners and admins. billing.unit identifies Builder.io credits, estimated dollars, mixed billing, or unknown.',
  http: { method: "GET" },
  schema: z.object({
    sinceDays: z.coerce.number().int().min(1).max(365).default(30),
    scope: z.enum(["me", "workspace"]).default("me"),
    userEmail: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Email of a member of this organization to filter usage to. Not for customers or other external accounts.",
      ),
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
    // scope "me" ignores userEmail, so only a workspace lookup is checked.
    if (
      scope === "workspace" &&
      userEmail &&
      ctx.orgId &&
      userEmail.toLowerCase() !== ctx.userEmail.toLowerCase()
    ) {
      // Unauthorized callers get one answer whether or not the email is a
      // member, so the lookup cannot be used to probe the roster.
      if (
        !(await canViewWorkspaceUsage({
          ownerEmail: ctx.userEmail,
          orgId: ctx.orgId,
        }))
      ) {
        fail(
          "Only organization owners and admins can look up another person's usage with get-usage-metrics. Usage, credits, or activity for customers, accounts, or companies belongs to the app that owns that data (see <relevant-apps> or run describe-workspace-apps with a query).",
          { errorCode: "usage_user_lookup_forbidden", statusCode: 403 },
        );
      }
      if (!(await isOrgMember(ctx.orgId, userEmail))) {
        fail(
          `${userEmail} is not a member of this organization. get-usage-metrics only covers this workspace's own agent usage; usage, credits, or activity for customers, accounts, or companies belongs to the app that owns that data (see <relevant-apps> or run describe-workspace-apps with a query).`,
          { errorCode: "usage_user_not_org_member", statusCode: 404 },
        );
      }
    }
    const selection = resolveAppSelection(app, appId);
    return listAppUsageMetrics(
      { sinceDays, scope, userEmail, builderCreditsEnabled: true },
      {
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
        app: selection,
      },
    );
  },
});
