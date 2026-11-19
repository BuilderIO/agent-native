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

const limitSource = z.enum(["default", "admin"]);
const outputSchema = z.object({
  limits: z.object({
    perJobCapUsd: z.number(),
    org: z.object({ dailyLimitUsd: z.number(), source: limitSource }),
    person: z
      .object({
        email: z.string(),
        noAskDailyAllowanceUsd: z.number(),
        dailyCeilingUsd: z.number(),
        source: limitSource,
      })
      .optional(),
    peopleWithAdminLimits: z.number(),
  }),
});

function limitsView(
  overrides: BigQueryAgentBudgetOverrides,
  email?: string,
): z.infer<typeof outputSchema>["limits"] {
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
  outputSchema,
  http: { method: "POST" },
  needsApproval: true,
  mcpTool: false,
  run: async (args, context?: ActionRunContext) => {
    if (
      isOutsideAgentCaller(context?.caller) ||
      context?.networkProtocol === "mcp" ||
      context?.networkProtocol === "a2a"
    ) {
      fail(
        "Outside agents cannot change BigQuery budgets. An organization admin can change them by asking Analytics' own agent in the app.",
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
              if (
                !(error instanceof BigQueryAgentBudgetUnavailableError) ||
                args.dailyLimitUsd !== null ||
                args.scope !== "org"
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
          'The stored BigQuery budget setting could not be read, so it was not changed. Resetting the limit for the whole organization (scope "org", dailyLimitUsd null) replaces it with the defaults for everyone.',
          { errorCode: "budget_unavailable", statusCode: 503 },
        );
      }
      throw error;
    }
    return { limits: limitsView(stored, email) };
  },
});
