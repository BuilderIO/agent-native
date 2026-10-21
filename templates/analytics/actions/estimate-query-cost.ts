import { defineAction, fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  getCredentialContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { isSafeDashboardId } from "../server/lib/dashboard-id";
import {
  pageDashboardConfig,
  resolveDashboardPanelQueries,
} from "../server/lib/dashboard-panel-verification";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";
import { getDashboard } from "../server/lib/dashboards-store";
import type { AnalyticsScope } from "../server/lib/first-party-analytics";
import {
  describeEstimate,
  describeReportSchedules,
  estimateBigQuerySql,
  estimateFirstPartySql,
  estimateResolvedPanels,
  formatBytes,
  formatUsd,
  ON_DEMAND_USD_PER_TIB,
  QUERY_COST_CAVEATS,
  QUERY_COST_THRESHOLDS,
  scheduledDashboardRuns,
  totalCost,
  type PanelCostEstimate,
} from "../server/lib/query-cost-estimate";
import { clipHead } from "../shared/panel-render-contract";

const MAX_PANELS = 60;
/** Stop starting dry runs here so the action returns before its 55 s timeout. */
const DASHBOARD_DEADLINE_MS = 40_000;

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export default defineAction({
  description:
    "Free cost estimate for BigQuery SQL. Dry-runs the query through Analytics' own BigQuery connection (BigQuery reads and bills nothing) and returns the bytes it would scan, dollars per run at on-demand pricing, and dollars per month for scheduled runs. " +
    "Pass `sql` to estimate any query (source 'bigquery' for warehouse SQL, 'first-party' for analytics_events SQL), or `dashboardId` (plus optional `panelId`) to estimate saved panels exactly as the dashboard runs them. " +
    `Call it before running or saving a query that may scan a large table, and before setting a byte cap (about 1.5x the estimate is common). Results over $${QUERY_COST_THRESHOLDS.perRunUsd}/run or $${QUERY_COST_THRESHOLDS.perMonthUsd}/month are flagged; tell the user the number before going ahead.`,
  schema: z.object({
    sql: z
      .string()
      .min(1)
      .optional()
      .describe(
        "SQL to estimate. Use this or dashboardId, not both. Dashboard {{filter}} tokens are not resolved here; pass dashboardId for saved panels.",
      ),
    source: z
      .enum(["bigquery", "first-party"])
      .optional()
      .default("bigquery")
      .describe(
        "Dialect of `sql`: 'bigquery' (standard SQL against the warehouse, the default) or 'first-party' (Analytics' analytics_events SQL, rendered the way first-party panels send it).",
      ),
    eventsSource: z
      .enum(["raw"])
      .optional()
      .describe(
        "First-party sql only: 'raw' prices the raw events table even when the events model covers the query. Alerts read the raw table, so pass it when estimating an alert.",
      ),
    dashboardId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Saved SQL dashboard to estimate. Without panelId, every queryable panel is estimated.",
      ),
    panelId: z
      .string()
      .min(1)
      .optional()
      .describe("One panel inside dashboardId."),
    filters: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Dashboard filter values keyed by filter id, e.g. {timeRange:'90d'}. Omit for the defaults a fresh tab shows.",
      ),
    // null and "" mean "not given", not 0, so the report-schedule default holds.
    runsPerMonth: z
      .preprocess(
        (value) => (value === null || value === "" ? undefined : value),
        z.coerce.number().int().min(0).max(100_000).optional(),
      )
      .describe(
        "Scheduled runs per month, e.g. 30 for a daily job or 8640 for a 5-minute alert. For a dashboard this defaults to one run a day per enabled email report; for raw SQL there is no monthly figure without it.",
      ),
  }),
  http: { method: "POST" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  timeoutMs: 55_000,
  run: async (args, context?: ActionRunContext) => {
    const startedAt = Date.now();
    if (Boolean(args.sql) === Boolean(args.dashboardId)) {
      fail("Pass exactly one of sql or dashboardId.", {
        errorCode: "invalid_target",
        statusCode: 400,
      });
    }
    if (args.panelId && !args.dashboardId) {
      fail("panelId needs dashboardId.", {
        errorCode: "invalid_target",
        statusCode: 400,
      });
    }
    if (args.eventsSource && !(args.sql && args.source === "first-party")) {
      fail("eventsSource applies only to first-party sql.", {
        errorCode: "invalid_target",
        statusCode: 400,
      });
    }
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to use this action.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    const credentialContext = getCredentialContext();
    const scope: AnalyticsScope = {
      userEmail,
      orgId,
      ...(credentialContext?.credentialScope === "org"
        ? { credentialScope: "org" as const }
        : {}),
    };
    const signal = context?.signal;
    const pricing = {
      model: "on-demand",
      usdPerTiB: ON_DEMAND_USD_PER_TIB,
      thresholds: QUERY_COST_THRESHOLDS,
    };

    if (args.sql) {
      const runsPerMonth = args.runsPerMonth ?? null;
      const estimate =
        args.source === "first-party"
          ? await estimateFirstPartySql(args.sql, scope, runsPerMonth, signal, {
              eventsSource: args.eventsSource,
            })
          : await estimateBigQuerySql(args.sql, runsPerMonth, signal);
      return {
        target: "sql",
        source: args.source,
        ...estimate,
        pricing,
        caveats: QUERY_COST_CAVEATS,
        summary: sentence(`Estimate: ${describeEstimate(estimate)}`),
      };
    }

    const dashboardId = args.dashboardId!;
    if (!isSafeDashboardId(dashboardId)) {
      fail(
        `${JSON.stringify(clipHead(dashboardId, 60))} is not a dashboard id: ids hold only letters, digits, dot, dash and underscore.`,
        { errorCode: "invalid_dashboard_id", statusCode: 400 },
      );
    }
    const dashboard = await getDashboard(dashboardId, {
      email: userEmail,
      orgId,
    });
    // Like get-sql-dashboard, a seed with the same id stands in for a stored
    // dashboard that isn't SQL.
    const stored = dashboard?.kind === "sql" ? dashboard : null;
    const seed = stored ? null : loadDashboardSeed(dashboardId);
    if (!stored && !seed) {
      if (dashboard) {
        fail(
          `estimate-query-cost only supports SQL dashboards; "${dashboardId}" is ${dashboard.kind}.`,
          { errorCode: "dashboard_not_sql", statusCode: 400 },
        );
      }
      fail(
        `Dashboard "${dashboardId}" was not found, or you don't have access to it.`,
        { errorCode: "dashboard_not_found", statusCode: 404 },
      );
    }

    const config = pageDashboardConfig(
      stored ? stored.config : seed!,
      dashboardId,
    );
    const resolved = resolveDashboardPanelQueries(config, args.filters);
    const selected = args.panelId
      ? resolved.filter((panel) => panel.panelId === args.panelId)
      : resolved;
    if (args.panelId && selected.length === 0) {
      fail(
        `Panel "${args.panelId}" is not a queryable panel in dashboard "${dashboardId}". Queryable panel ids: ${resolved
          .slice(0, 40)
          .map((panel) => panel.panelId)
          .join(", ")}.`,
        { errorCode: "panel_not_found", statusCode: 404 },
      );
    }

    const schedule = await scheduledDashboardRuns(dashboardId, scope);
    const reportSchedules = schedule.reportSchedules;
    const runsPerMonth = args.runsPerMonth ?? schedule.runsPerMonth;
    const panels: PanelCostEstimate[] = await estimateResolvedPanels(
      selected.slice(0, MAX_PANELS),
      scope,
      runsPerMonth,
      startedAt + DASHBOARD_DEADLINE_MS,
      signal,
    );
    const total = totalCost(panels);
    const flagged = panels.filter(
      (panel) =>
        panel.status === "estimated" &&
        (panel.overPerRunThreshold || panel.overPerMonthThreshold),
    );
    const failed = panels.filter((panel) => panel.status === "failed").length;
    const priced = panels.filter(
      (panel) => panel.status === "estimated",
    ).length;
    const notEstimated = panels.filter(
      (panel) => panel.status === "not_estimated",
    ).length;
    const omitted = Math.max(0, selected.length - MAX_PANELS);
    // Panels outside BigQuery cost nothing; any other gap makes the total partial.
    const partial = failed + notEstimated + omitted > 0;
    // With panelId the total is that panel's, never the dashboard's.
    const onePanel = args.panelId !== undefined;
    const totalScope = onePanel
      ? "per refresh of this panel"
      : partial
        ? "per refresh of the priced panels only"
        : "per full refresh";
    // Report schedules keep their own saved filters; this prices them at the
    // filters passed here (or the defaults), so say so.
    const monthly =
      total.usdPerMonth === null
        ? "no scheduled runs"
        : args.runsPerMonth === undefined
          ? `~${formatUsd(total.usdPerMonth)}/month if its email reports use these filters`
          : `~${formatUsd(total.usdPerMonth)}/month in scheduled runs`;
    const totalOver = [
      total.overPerRunThreshold &&
        `the ${formatUsd(QUERY_COST_THRESHOLDS.perRunUsd)}/run`,
      total.overPerMonthThreshold &&
        `the ${formatUsd(QUERY_COST_THRESHOLDS.perMonthUsd)}/month`,
    ].filter(Boolean);

    return {
      target: "dashboard",
      dashboardId,
      filterState:
        args.filters && Object.keys(args.filters).length > 0
          ? "overridden"
          : "defaults",
      runsPerMonth,
      runsPerMonthBasis:
        args.runsPerMonth !== undefined
          ? "caller"
          : reportSchedules > 0
            ? describeReportSchedules(reportSchedules, orgId)
            : "none",
      total: {
        ...total,
        partial,
        scope: onePanel ? "panel" : "dashboard",
      },
      panels,
      ...(selected.length > MAX_PANELS
        ? { omittedPanelIds: selected.slice(MAX_PANELS).map((p) => p.panelId) }
        : {}),
      pricing,
      caveats: QUERY_COST_CAVEATS,
      summary:
        (priced === 0
          ? `${panels.length} panel${panels.length === 1 ? "" : "s"}: ${partial ? "none could be priced." : "none read BigQuery, so nothing was priced."}`
          : `${panels.length} panel${panels.length === 1 ? "" : "s"} (${priced} priced): ~${formatBytes(total.estimatedBytes)} and ${formatUsd(total.usdPerRun)} ${totalScope}, ${monthly}.`) +
        (totalOver.length && !onePanel
          ? ` The dashboard as a whole is over ${totalOver.join(" and ")} threshold${totalOver.length > 1 ? "s" : ""}${partial ? ", even counting only the priced panels" : ""}.`
          : "") +
        (flagged.length
          ? ` Over threshold: ${flagged.map((panel) => `"${panel.title}" (${describeEstimate(panel)})`).join("; ")}.`
          : "") +
        (failed
          ? ` ${failed} panel${failed === 1 ? "" : "s"} could not be estimated.`
          : "") +
        (notEstimated
          ? ` ${notEstimated} panel${notEstimated === 1 ? "" : "s"} may read BigQuery but ${notEstimated === 1 ? "isn't" : "aren't"} priced here.`
          : "") +
        (omitted
          ? ` ${omitted} panel${omitted === 1 ? "" : "s"} past the first ${MAX_PANELS} ${omitted === 1 ? "wasn't" : "weren't"} estimated (see omittedPanelIds).`
          : ""),
    };
  },
});
