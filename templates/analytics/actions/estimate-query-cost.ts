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
  type ResolvedDashboardPanelQuery,
} from "../server/lib/dashboard-panel-verification";
import { countEnabledDashboardReportSubscriptions } from "../server/lib/dashboard-report-subscriptions";
import { loadDashboardSeed } from "../server/lib/dashboard-seeds";
import { getDashboard } from "../server/lib/dashboards-store";
import type { AnalyticsScope } from "../server/lib/first-party-analytics";
import {
  DAYS_PER_MONTH,
  estimateBigQuerySql,
  estimateFirstPartySql,
  estimateResolvedPanel,
  formatBytes,
  formatUsd,
  ON_DEMAND_USD_PER_TIB,
  QUERY_COST_CAVEATS,
  QUERY_COST_THRESHOLDS,
  totalCost,
  type PanelCostEstimate,
  type QueryCostEstimate,
} from "../server/lib/query-cost-estimate";
import { clipHead } from "../shared/panel-render-contract";

const MAX_PANELS = 60;
const DRY_RUN_CONCURRENCY = 6;
/** Stop starting dry runs here so the action returns before its 55 s timeout. */
const DASHBOARD_DEADLINE_MS = 40_000;

function timedOutPanel(
  panel: { panelId: string; title: string; source: string },
  error: string,
): PanelCostEstimate {
  return {
    panelId: panel.panelId,
    title: panel.title,
    source: panel.source,
    status: "failed",
    failure: "timeout",
    error,
  };
}

/**
 * Estimate one panel, but give up when the dashboard deadline passes, even
 * mid-way through credential, table, or backend lookups, so finished panels
 * still come back before the action's own timeout.
 */
async function estimatePanelBefore(
  deadline: number,
  panel: ResolvedDashboardPanelQuery,
  scope: AnalyticsScope,
  runsPerMonth: number | null,
  signal?: AbortSignal,
): Promise<PanelCostEstimate> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return timedOutPanel(
      panel,
      "Skipped: this request ran out of time. Estimate this panel on its own with panelId.",
    );
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PanelCostEstimate>((resolve) => {
    timer = setTimeout(() => {
      resolve(
        timedOutPanel(
          panel,
          "Stopped: this panel's dry run didn't finish in time. Estimate it on its own with panelId.",
        ),
      );
      controller.abort();
    }, remaining);
  });
  try {
    return await Promise.race([
      estimateResolvedPanel(panel, scope, runsPerMonth, controller.signal),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function describeEstimate(estimate: QueryCostEstimate): string {
  if (
    estimate.status === "not_bigquery" ||
    estimate.status === "not_estimated"
  ) {
    return estimate.reason;
  }
  if (estimate.status === "failed") {
    return `no estimate (${estimate.failure}): ${estimate.error}`;
  }
  const monthly =
    estimate.usdPerMonth === null
      ? "not scheduled"
      : `~${formatUsd(estimate.usdPerMonth)}/month over ${estimate.runsPerMonth} scheduled runs`;
  const flags = [
    estimate.overPerRunThreshold
      ? `over the ${formatUsd(QUERY_COST_THRESHOLDS.perRunUsd)}/run threshold`
      : null,
    estimate.overPerMonthThreshold
      ? `over the ${formatUsd(QUERY_COST_THRESHOLDS.perMonthUsd)}/month threshold`
      : null,
  ].filter(Boolean);
  return `~${formatBytes(estimate.estimatedBytes)}, ${formatUsd(estimate.usdPerRun)} per run, ${monthly}${flags.length ? ` (${flags.join("; ")})` : ""}`;
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
          ? await estimateFirstPartySql(args.sql, scope, runsPerMonth, signal)
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

    const reportSchedules = await countEnabledDashboardReportSubscriptions(
      dashboardId,
      { email: userEmail, orgId },
    );
    const runsPerMonth =
      args.runsPerMonth ??
      (reportSchedules > 0 ? reportSchedules * DAYS_PER_MONTH : null);
    const estimated = selected.slice(0, MAX_PANELS);
    const deadline = startedAt + DASHBOARD_DEADLINE_MS;
    const panels: PanelCostEstimate[] = await mapPool(
      estimated,
      DRY_RUN_CONCURRENCY,
      (panel) =>
        estimatePanelBefore(deadline, panel, scope, runsPerMonth, signal),
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
    const totalScope = partial
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
    const totalFlags = {
      overPerRunThreshold: total.usdPerRun > QUERY_COST_THRESHOLDS.perRunUsd,
      overPerMonthThreshold:
        total.usdPerMonth !== null &&
        total.usdPerMonth > QUERY_COST_THRESHOLDS.perMonthUsd,
    };
    const totalOver = [
      totalFlags.overPerRunThreshold &&
        `the ${formatUsd(QUERY_COST_THRESHOLDS.perRunUsd)}/run`,
      totalFlags.overPerMonthThreshold &&
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
            ? `${reportSchedules} enabled daily email report${reportSchedules === 1 ? "" : "s"}`
            : "none",
      total: { ...total, ...totalFlags, partial },
      panels,
      ...(selected.length > MAX_PANELS
        ? { omittedPanelIds: selected.slice(MAX_PANELS).map((p) => p.panelId) }
        : {}),
      pricing,
      caveats: QUERY_COST_CAVEATS,
      summary:
        (priced === 0
          ? `${panels.length} panel${panels.length === 1 ? "" : "s"}: none read BigQuery, so nothing was priced.`
          : `${panels.length} panel${panels.length === 1 ? "" : "s"} (${priced} priced): ~${formatBytes(total.estimatedBytes)} and ${formatUsd(total.usdPerRun)} ${totalScope}, ${monthly}.`) +
        (totalOver.length
          ? ` The dashboard as a whole is over ${totalOver.join(" and ")} threshold${partial ? ", even counting only the priced panels" : ""}.`
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
