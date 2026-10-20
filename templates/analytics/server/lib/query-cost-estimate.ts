import {
  BigQueryDryRunPreparationError,
  dryRunQuerySchema,
} from "./bigquery.js";
import { describeError } from "./dashboard-panel-runner.js";
import type { ResolvedDashboardPanelQuery } from "./dashboard-panel-verification.js";
import { countEnabledDashboardReportSubscriptions } from "./dashboard-report-subscriptions.js";
import {
  renderFirstPartyAnalyticsBigQueryEstimateSql,
  type AnalyticsScope,
} from "./first-party-analytics.js";
import { assertReadOnlySql } from "./read-only-sql.js";

/** BigQuery on-demand list price, US multi-region. */
export const ON_DEMAND_USD_PER_TIB = 6.25;
/** On-demand bills at least 10 MiB for any query that reads data. */
export const MIN_BILLED_BYTES_PER_QUERY = 10 * 1024 ** 2;
/** Above either, the estimate is flagged as expensive. */
export const QUERY_COST_THRESHOLDS = { perRunUsd: 1, perMonthUsd: 50 };
export const DAYS_PER_MONTH = 30;

const TIB = 1024 ** 4;
const GIB = 1024 ** 3;

export const QUERY_COST_CAVEATS = [
  "Prices use BigQuery on-demand list price, $6.25 per TiB (US and EU multi-region), with the 10 MiB per-query minimum. BigQuery also bills at least 10 MiB per table referenced, and the first 1 TiB each month is free; neither is counted. Projects on editions or reservations don't pay per byte.",
  "A dry run counts partition and column pruning but not clustering, so a query filtered on a clustered column (such as event_name) usually bills less than this.",
  "Per-month figures count only scheduled runs: runsPerMonth when given, otherwise one run a day for each enabled email report on the dashboard in your org (your own without an org; other people's reports run on their own BigQuery connection), priced at the filters you passed (or the defaults), not each report's own saved filters. Reports that share filters can hit the 24-hour result cache, so that figure is an upper bound. People opening the dashboard add more runs; each viewer's results are cached for up to 24 hours.",
];

export type QueryCostFailure =
  | "not_connected"
  | "invalid_sql"
  | "timeout"
  | "no_estimate";

export type QueryCostEstimate =
  | {
      status: "estimated";
      estimatedBytes: number;
      estimatedGiB: number;
      usdPerRun: number;
      runsPerMonth: number | null;
      usdPerMonth: number | null;
      overPerRunThreshold: boolean;
      overPerMonthThreshold: boolean;
    }
  | {
      /** The query runs somewhere other than BigQuery, so it costs no bytes. */
      status: "not_bigquery";
      reason: string;
    }
  | {
      /** The panel may bill BigQuery, but this action can't price it. */
      status: "not_estimated";
      reason: string;
    }
  | { status: "failed"; failure: QueryCostFailure; error: string };

function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function usdForBytes(bytes: number): number {
  if (bytes <= 0) return 0;
  return (
    (Math.max(bytes, MIN_BILLED_BYTES_PER_QUERY) / TIB) * ON_DEMAND_USD_PER_TIB
  );
}

export function costFromBytes(
  bytes: number,
  runsPerMonth: number | null,
): Extract<QueryCostEstimate, { status: "estimated" }> {
  const usdPerRun = usdForBytes(bytes);
  const usdPerMonth = runsPerMonth === null ? null : usdPerRun * runsPerMonth;
  return {
    status: "estimated",
    estimatedBytes: bytes,
    estimatedGiB: Math.round((bytes / GIB) * 1000) / 1000,
    usdPerRun: roundUsd(usdPerRun),
    runsPerMonth,
    usdPerMonth: usdPerMonth === null ? null : roundUsd(usdPerMonth),
    overPerRunThreshold: usdPerRun > QUERY_COST_THRESHOLDS.perRunUsd,
    overPerMonthThreshold:
      usdPerMonth !== null && usdPerMonth > QUERY_COST_THRESHOLDS.perMonthUsd,
  };
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** BigQuery's 404 for a table or dataset the query names that doesn't exist. */
const MISSING_QUERY_RESOURCE = /\bNot found: (Table|Dataset)\b/i;

/** Dry-run BigQuery SQL. Free: BigQuery reads and bills nothing. */
export async function estimateBigQuerySql(
  sql: string,
  runsPerMonth: number | null,
  signal?: AbortSignal,
): Promise<QueryCostEstimate> {
  try {
    assertReadOnlySql(sql, "bigquery");
  } catch (error) {
    return {
      status: "failed",
      failure: "invalid_sql",
      error: describeError(error),
    };
  }
  let dryRun: Awaited<ReturnType<typeof dryRunQuerySchema>>;
  try {
    dryRun = await dryRunQuerySchema(sql, {
      signal,
      wrapPreparationErrors: true,
    });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return error instanceof BigQueryDryRunPreparationError &&
      error.notConfigured
      ? {
          status: "failed",
          failure: "not_connected",
          error:
            "BigQuery isn't connected for this user. Connect it in Settings → Data sources.",
        }
      : {
          status: "failed",
          failure: "no_estimate",
          error: "The BigQuery dry run could not be completed.",
        };
  }
  if (dryRun.error !== null) {
    if (dryRun.timedOut) {
      return {
        status: "failed",
        failure: "timeout",
        error: describeError(dryRun.error),
      };
    }
    // A 400, or a 404 naming a table or dataset the query reads, means
    // BigQuery rejected the SQL; auth, quota, and server errors say nothing
    // about the query.
    return dryRun.status === undefined ||
      dryRun.status === 400 ||
      (dryRun.status === 404 && MISSING_QUERY_RESOURCE.test(dryRun.error))
      ? {
          status: "failed",
          failure: "invalid_sql",
          error: describeError(dryRun.error),
        }
      : {
          status: "failed",
          failure: "no_estimate",
          error: `BigQuery couldn't run the dry run (HTTP ${dryRun.status}). Try again later or check the BigQuery connection in Settings → Data sources.`,
        };
  }
  if (
    dryRun.totalBytesProcessed === undefined ||
    !Number.isFinite(dryRun.totalBytesProcessed) ||
    dryRun.totalBytesProcessed < 0
  ) {
    return {
      status: "failed",
      failure: "no_estimate",
      error: "BigQuery returned no byte estimate for this query.",
    };
  }
  return costFromBytes(dryRun.totalBytesProcessed, runsPerMonth);
}

/**
 * Dry-run first-party analytics SQL (the `analytics_events` dialect) after
 * rendering it exactly as the panel would send it to BigQuery. `eventsSource:
 * "raw"` prices the raw events table, as alerts read it.
 */
export async function estimateFirstPartySql(
  sql: string,
  scope: AnalyticsScope,
  runsPerMonth: number | null,
  signal?: AbortSignal,
  options: { eventsSource?: "raw" } = {},
): Promise<QueryCostEstimate> {
  let rendered: Awaited<
    ReturnType<typeof renderFirstPartyAnalyticsBigQueryEstimateSql>
  >;
  try {
    rendered = await renderFirstPartyAnalyticsBigQueryEstimateSql(
      sql,
      scope,
      signal,
      options,
    );
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    return {
      status: "failed",
      failure: "no_estimate",
      error: "The first-party analytics backend could not be loaded.",
    };
  }
  if (rendered.target === "invalid") {
    return {
      status: "failed",
      failure: "invalid_sql",
      error: describeError(rendered.error),
    };
  }
  if (rendered.target !== "bigquery") {
    return {
      status: "not_bigquery",
      reason:
        "This first-party query runs in the Analytics SQL store, not BigQuery.",
    };
  }
  return estimateBigQuerySql(rendered.sql, runsPerMonth, signal);
}

export type PanelCostEstimate = {
  panelId: string;
  title: string;
  source: string;
} & QueryCostEstimate;

export async function estimateResolvedPanel(
  panel: ResolvedDashboardPanelQuery,
  scope: AnalyticsScope,
  runsPerMonth: number | null,
  signal?: AbortSignal,
): Promise<PanelCostEstimate> {
  const base = {
    panelId: panel.panelId,
    title: panel.title,
    source: panel.source,
  };
  if ("error" in panel) {
    return {
      ...base,
      status: "failed",
      failure: "invalid_sql",
      error: describeError(panel.error),
    };
  }
  if (panel.source === "bigquery") {
    return {
      ...base,
      ...(await estimateBigQuerySql(panel.query, runsPerMonth, signal)),
    };
  }
  if (panel.source === "first-party") {
    return {
      ...base,
      ...(await estimateFirstPartySql(
        panel.query,
        scope,
        runsPerMonth,
        signal,
      )),
    };
  }
  if (panel.source === "program") {
    return {
      ...base,
      status: "not_estimated",
      reason:
        "Data-program panels can compute in BigQuery, but their cost isn't estimated here.",
    };
  }
  return {
    ...base,
    status: "not_bigquery",
    reason: `This panel reads ${panel.source || "an unknown source"}, which has no BigQuery cost.`,
  };
}

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
 * Ends a batch early without losing it: panels still running or not yet
 * started come back timed out with `error`, and finished panels keep their
 * estimates.
 */
export interface EstimateStop {
  signal: AbortSignal;
  error: string;
}

/**
 * Estimate one panel, but give up when the deadline passes or `stop` fires,
 * even mid-way through credential, table, or backend lookups, so finished
 * panels still come back before the caller's own timeout.
 */
async function estimatePanelBefore(
  deadline: number,
  panel: ResolvedDashboardPanelQuery,
  scope: AnalyticsScope,
  runsPerMonth: number | null,
  signal?: AbortSignal,
  stop?: EstimateStop,
): Promise<PanelCostEstimate> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return timedOutPanel(
      panel,
      "Skipped: this request ran out of time. Estimate this panel on its own with panelId.",
    );
  }
  if (stop?.signal.aborted) return timedOutPanel(panel, stop.error);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onStop: (() => void) | undefined;
  const timedOut = new Promise<PanelCostEstimate>((resolve) => {
    const giveUp = (error: string) => {
      resolve(timedOutPanel(panel, error));
      controller.abort();
    };
    timer = setTimeout(
      () =>
        giveUp(
          "Stopped: this panel's dry run didn't finish in time. Estimate it on its own with panelId.",
        ),
      remaining,
    );
    if (stop) {
      onStop = () => giveUp(stop.error);
      stop.signal.addEventListener("abort", onStop, { once: true });
    }
  });
  try {
    return await Promise.race([
      estimateResolvedPanel(panel, scope, runsPerMonth, controller.signal),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
    if (onStop) stop?.signal.removeEventListener("abort", onStop);
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

const DRY_RUN_CONCURRENCY = 6;

/**
 * Dry-run resolved panels a few at a time; none starts after `deadline` or
 * once `stop` fires.
 */
export function estimateResolvedPanels(
  panels: readonly ResolvedDashboardPanelQuery[],
  scope: AnalyticsScope,
  runsPerMonth: number | null,
  deadline: number,
  signal?: AbortSignal,
  stop?: EstimateStop,
): Promise<PanelCostEstimate[]> {
  return mapPool(panels, DRY_RUN_CONCURRENCY, (panel) =>
    estimatePanelBefore(deadline, panel, scope, runsPerMonth, signal, stop),
  );
}

/**
 * One run a day for each enabled email report on the dashboard in the
 * caller's tenant; other tenants' reports run on their own BigQuery
 * connection.
 */
export async function scheduledDashboardRuns(
  dashboardId: string,
  scope: AnalyticsScope,
): Promise<{ reportSchedules: number; runsPerMonth: number | null }> {
  const reportSchedules = await countEnabledDashboardReportSubscriptions(
    dashboardId,
    { email: scope.userEmail, orgId: scope.orgId },
  );
  return {
    reportSchedules,
    runsPerMonth: reportSchedules > 0 ? reportSchedules * DAYS_PER_MONTH : null,
  };
}

export function describeReportSchedules(
  reportSchedules: number,
  orgId: string | null,
): string {
  return `${reportSchedules} enabled daily email report${reportSchedules === 1 ? "" : "s"} ${orgId ? "in your org" : "of yours"}`;
}

export function describeEstimate(estimate: QueryCostEstimate): string {
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

export function totalCost(estimates: readonly QueryCostEstimate[]): {
  estimatedBytes: number;
  usdPerRun: number;
  usdPerMonth: number | null;
  overPerRunThreshold: boolean;
  overPerMonthThreshold: boolean;
} {
  const estimated = estimates.filter(
    (
      estimate,
    ): estimate is Extract<QueryCostEstimate, { status: "estimated" }> =>
      estimate.status === "estimated",
  );
  const monthly = estimated.filter((estimate) => estimate.usdPerMonth !== null);
  const usdPerRun = roundUsd(
    estimated.reduce((sum, e) => sum + e.usdPerRun, 0),
  );
  const usdPerMonth =
    monthly.length === 0
      ? null
      : roundUsd(monthly.reduce((sum, e) => sum + (e.usdPerMonth ?? 0), 0));
  return {
    estimatedBytes: estimated.reduce((sum, e) => sum + e.estimatedBytes, 0),
    usdPerRun,
    usdPerMonth,
    overPerRunThreshold: usdPerRun > QUERY_COST_THRESHOLDS.perRunUsd,
    overPerMonthThreshold:
      usdPerMonth !== null && usdPerMonth > QUERY_COST_THRESHOLDS.perMonthUsd,
  };
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= TIB) return `${(bytes / TIB).toFixed(2)} TiB`;
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}
