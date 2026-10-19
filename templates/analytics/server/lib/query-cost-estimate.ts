import {
  BigQueryDryRunPreparationError,
  dryRunQuerySchema,
} from "./bigquery.js";
import { describeError } from "./dashboard-panel-runner.js";
import type { ResolvedDashboardPanelQuery } from "./dashboard-panel-verification.js";
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
  "Per-month figures count only scheduled runs: runsPerMonth when given, otherwise one run a day for each enabled email report on the dashboard (on a built-in dashboard, only reports in your org), priced at the filters you passed (or the defaults), not each report's own saved filters. Reports that share filters can hit the 24-hour result cache, so that figure is an upper bound. People opening the dashboard add more runs; each viewer's results are cached for up to 24 hours.",
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
    // Only a 400 means BigQuery rejected the SQL; auth, quota, and server
    // errors say nothing about the query.
    return dryRun.status === undefined || dryRun.status === 400
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

export function totalCost(estimates: readonly QueryCostEstimate[]): {
  estimatedBytes: number;
  usdPerRun: number;
  usdPerMonth: number | null;
} {
  const estimated = estimates.filter(
    (
      estimate,
    ): estimate is Extract<QueryCostEstimate, { status: "estimated" }> =>
      estimate.status === "estimated",
  );
  const monthly = estimated.filter((estimate) => estimate.usdPerMonth !== null);
  return {
    estimatedBytes: estimated.reduce((sum, e) => sum + e.estimatedBytes, 0),
    usdPerRun: roundUsd(estimated.reduce((sum, e) => sum + e.usdPerRun, 0)),
    usdPerMonth:
      monthly.length === 0
        ? null
        : roundUsd(monthly.reduce((sum, e) => sum + (e.usdPerMonth ?? 0), 0)),
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
