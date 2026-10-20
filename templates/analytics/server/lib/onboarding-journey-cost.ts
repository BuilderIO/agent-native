import {
  BigQueryDryRunPreparationError,
  dryRunQuerySchema,
} from "./bigquery.js";
import {
  getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsTable,
  renderFirstPartyAnalyticsBigQueryRequestSql,
} from "./first-party-analytics-backend.js";
import {
  scopedAnalyticsSql,
  type AnalyticsScope,
} from "./first-party-analytics.js";
import type {
  OnboardingJourneyEventsFilters,
  OnboardingJourneyObservationWindow,
} from "./first-party-metric-catalog.js";
import {
  buildOnboardingJourneyEventPageRequest,
  MAX_ONBOARDING_EVENT_READ_PAGES,
  ONBOARDING_EVENT_PAGE_ROWS,
  ONBOARDING_EVENTS_MAX_BYTES_BILLED,
} from "./onboarding-journey.js";

export type OnboardingJourneyCostFailureCode =
  | "unsupported_backend"
  | "preparation_failed"
  | "dry_run_failed"
  | "dry_run_timeout"
  | "estimate_unavailable";

export class OnboardingJourneyCostError extends Error {
  constructor(readonly code: OnboardingJourneyCostFailureCode) {
    super("The scoped onboarding journey cost estimate is unavailable.");
    this.name = "OnboardingJourneyCostError";
  }
}

export interface OnboardingJourneyCostEstimate {
  status: "within_cap" | "over_cap";
  maxBytesBilledPerQuery: number;
  possiblePagesEstimatedBytes: number;
  pages: Array<{
    page: number;
    offset: number;
    estimatedBytes: number;
  }>;
}

export async function estimateOnboardingJourneyEventQueryCost(
  scope: AnalyticsScope,
  filters: OnboardingJourneyEventsFilters,
  maxEventRows: number,
  observation: OnboardingJourneyObservationWindow,
  freezeReceivedAt: boolean,
  signal?: AbortSignal,
): Promise<OnboardingJourneyCostEstimate> {
  let backend: Awaited<ReturnType<typeof getFirstPartyAnalyticsBackend>>;
  try {
    backend = await getFirstPartyAnalyticsBackend(scope, signal);
  } catch (error) {
    throwPreparationFailure(error, signal);
  }
  if (backend.sink !== "bigquery") {
    throw new OnboardingJourneyCostError("unsupported_backend");
  }
  let table: Awaited<ReturnType<typeof getFirstPartyAnalyticsTable>>;
  try {
    table = await getFirstPartyAnalyticsTable(backend.table, signal);
  } catch (error) {
    throwPreparationFailure(error, signal);
  }
  const pageOffsets = Array.from(
    { length: MAX_ONBOARDING_EVENT_READ_PAGES },
    (_unused, index) => index * ONBOARDING_EVENT_PAGE_ROWS,
  ).filter((offset) => offset <= maxEventRows);
  const pages: OnboardingJourneyCostEstimate["pages"] = [];

  for (const [index, offset] of pageOffsets.entries()) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let renderedSql: string;
    try {
      const request = buildOnboardingJourneyEventPageRequest(
        filters,
        maxEventRows,
        offset,
        observation,
        freezeReceivedAt,
      );
      const scoped = scopedAnalyticsSql(request.sql, scope, undefined, {
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
        scopedEventsSourceProjections: {
          e: "onboarding_journey",
          r: "onboarding_journey_response_identity",
        },
      });
      renderedSql = renderFirstPartyAnalyticsBigQueryRequestSql(
        scoped.sql,
        scoped.args,
        table,
        {
          eventDateRange: request.eventDateRange,
          scopedEventsSingleScan: true,
          scopedEventsProjection: "onboarding_journey",
          scopedEventsSourceProjections: {
            e: "onboarding_journey",
            r: "onboarding_journey_response_identity",
          },
        },
      );
    } catch (error) {
      throwPreparationFailure(error, signal);
    }
    let dryRun: Awaited<ReturnType<typeof dryRunQuerySchema>>;
    try {
      dryRun = await dryRunQuerySchema(renderedSql, {
        signal,
        wrapPreparationErrors: true,
      });
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      throw new OnboardingJourneyCostError(
        error instanceof BigQueryDryRunPreparationError
          ? "preparation_failed"
          : "dry_run_failed",
      );
    }
    if (dryRun.error !== null) {
      throw new OnboardingJourneyCostError(
        dryRun.timedOut ? "dry_run_timeout" : "dry_run_failed",
      );
    }
    const estimatedBytes = dryRun.totalBytesProcessed;
    if (
      typeof estimatedBytes !== "number" ||
      !Number.isSafeInteger(estimatedBytes) ||
      estimatedBytes < 0
    ) {
      throw new OnboardingJourneyCostError("estimate_unavailable");
    }
    pages.push({
      page: index + 1,
      offset,
      estimatedBytes,
    });
  }

  const possiblePagesEstimatedBytes = pages.reduce(
    (total, page) => total + page.estimatedBytes,
    0,
  );
  if (!Number.isSafeInteger(possiblePagesEstimatedBytes)) {
    throw new OnboardingJourneyCostError("estimate_unavailable");
  }
  return {
    status: pages.some(
      (page) => page.estimatedBytes > ONBOARDING_EVENTS_MAX_BYTES_BILLED,
    )
      ? "over_cap"
      : "within_cap",
    maxBytesBilledPerQuery: ONBOARDING_EVENTS_MAX_BYTES_BILLED,
    possiblePagesEstimatedBytes,
    pages,
  };
}

function throwPreparationFailure(error: unknown, signal?: AbortSignal): never {
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    throw error;
  }
  throw new OnboardingJourneyCostError("preparation_failed");
}
