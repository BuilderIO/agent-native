import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { mutateOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  ADMIN_MAX_ORG_DAILY_BYTES,
  ADMIN_MAX_PERSON_DAILY_BYTES,
  BIGQUERY_AGENT_BUDGET_SETTING_KEY,
  BigQueryAgentBudgetUnavailableError,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
  parseBigQueryAgentBudgetOverrides,
  usd,
  type BigQueryAgentBudgetOverrides,
} from "../server/lib/bigquery-agent-budget.js";
import { isOutsideAgentCaller } from "../server/lib/bigquery-agent-context.js";
import { billedBytesForUsd } from "../server/lib/bigquery-pricing.js";
import {
  DbAdminConnectionError,
  requireAnalyticsAdminContext,
  resolveOrgRole,
} from "../server/lib/db-admin-connections.js";

function limitsView(overrides: BigQueryAgentBudgetOverrides, email?: string) {
  const person = email
    ? overrides.personDailyAllowanceBytes?.[email]
    : undefined;
  return {
    perJobCapUsd: usd(OUTSIDE_AGENT_JOB_CAP_BYTES),
    org: {
      dailyLimitUsd: usd(
        overrides.orgDailyLimitBytes ?? OUTSIDE_AGENT_ORG_LIMIT_BYTES,
      ),
      source: overrides.orgDailyLimitBytes === undefined ? "default" : "admin",
    },
    ...(email
      ? {
          person: {
            email,
            noAskDailyAllowanceUsd: usd(
              person ?? OUTSIDE_AGENT_PERSON_BASE_BYTES,
            ),
            dailyCeilingUsd: usd(
              Math.max(
                OUTSIDE_AGENT_PERSON_CEILING_BYTES,
                person ?? OUTSIDE_AGENT_PERSON_BASE_BYTES,
              ),
            ),
            source: person === undefined ? "default" : "admin",
          },
        }
      : {}),
    peopleWithAdminLimits: Object.keys(
      overrides.personDailyAllowanceBytes ?? {},
    ).length,
  };
}

export default defineAction({
  description:
    'Set the daily BigQuery budget for outside agents (MCP clients such as Claude Code, Cursor or Codex) in this organization. Organization owners and admins only. scope "org" sets the organization\'s daily limit for every outside-agent job (default $50); scope "person" sets one member\'s daily allowance, which runs without asking (default $1, with a $5 ceiling). dailyLimitUsd null restores the default. The 50 GB per-job limit is fixed. Analytics\' own agent and dashboards are not affected. Returns the limits now in effect.',
  schema: z
    .object({
      scope: z
        .enum(["org", "person"])
        .describe('"org" for the organization limit, "person" for one member.'),
      email: z
        .string()
        .email()
        .optional()
        .describe(
          'The member whose allowance to set; required for scope "person".',
        ),
      dailyLimitUsd: z
        .number()
        .min(0)
        .nullable()
        .describe(
          "New daily limit in US dollars at BigQuery on-demand list price ($6.25 per TiB), or null for the default.",
        ),
    })
    .superRefine((args, ctx) => {
      if (args.scope === "person" && !args.email) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: 'email is required for scope "person".',
        });
      }
      const max =
        args.scope === "org"
          ? ADMIN_MAX_ORG_DAILY_BYTES
          : ADMIN_MAX_PERSON_DAILY_BYTES;
      if (
        args.dailyLimitUsd !== null &&
        billedBytesForUsd(args.dailyLimitUsd) > max
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["dailyLimitUsd"],
          message: `dailyLimitUsd may be at most $${usd(max)} for scope "${args.scope}".`,
        });
      }
    }),
  http: { method: "POST" },
  needsApproval: true,
  mcpTool: false,
  run: async (args, context?: ActionRunContext) => {
    // An outside agent must never raise the budget that bounds it.
    if (isOutsideAgentCaller(context?.caller)) {
      fail(
        "Outside agents cannot change BigQuery budgets. An organization admin can change them from Analytics' own agent.",
        { errorCode: "forbidden", statusCode: 403 },
      );
    }
    let admin: Awaited<ReturnType<typeof requireAnalyticsAdminContext>>;
    try {
      admin = await requireAnalyticsAdminContext();
    } catch (error) {
      if (error instanceof DbAdminConnectionError) {
        fail(error.message, {
          errorCode:
            error.statusCode === 503 ? "role_unavailable" : "forbidden",
          statusCode: error.statusCode,
        });
      }
      throw error;
    }
    const email = args.email?.trim().toLowerCase();
    if (args.scope === "person" && email) {
      if (!(await resolveOrgRole(email, admin.orgId))) {
        fail(`${email} is not a member of this organization.`, {
          errorCode: "not_a_member",
          statusCode: 404,
        });
      }
    }
    const bytes =
      args.dailyLimitUsd === null
        ? null
        : billedBytesForUsd(args.dailyLimitUsd);
    let stored: BigQueryAgentBudgetOverrides;
    try {
      stored = parseBigQueryAgentBudgetOverrides(
        await mutateOrgSetting(
          admin.orgId,
          BIGQUERY_AGENT_BUDGET_SETTING_KEY,
          (current) => {
            let next: BigQueryAgentBudgetOverrides;
            try {
              next = parseBigQueryAgentBudgetOverrides(current);
            } catch (error) {
              // An unreadable setting refuses every outside-agent job, so a
              // reset to the defaults replaces it instead of failing on it.
              if (
                !(error instanceof BigQueryAgentBudgetUnavailableError) ||
                args.dailyLimitUsd !== null
              ) {
                throw error;
              }
              next = {};
            }
            if (args.scope === "org") {
              if (bytes === null) delete next.orgDailyLimitBytes;
              else next.orgDailyLimitBytes = bytes;
            } else if (email) {
              const people = { ...next.personDailyAllowanceBytes };
              if (bytes === null) delete people[email];
              else people[email] = bytes;
              next.personDailyAllowanceBytes = people;
            }
            return {
              ...next,
              updatedAt: new Date().toISOString(),
              updatedBy: admin.userEmail,
            };
          },
        ),
      );
    } catch (error) {
      if (error instanceof BigQueryAgentBudgetUnavailableError) {
        fail(
          "The stored BigQuery budget setting could not be read, so it was not changed.",
          { errorCode: "budget_unavailable", statusCode: 503 },
        );
      }
      throw error;
    }
    return { limits: limitsView(stored, email) };
  },
});
