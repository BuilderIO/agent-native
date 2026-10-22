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
  getOnboardingJourneyEventReadPageBudget,
  getOnboardingJourneyEventReadPageCount,
  ONBOARDING_EVENT_READ_DEADLINE_MS,
  ONBOARDING_EVENT_PAGE_ROWS,
  ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED,
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
  status: "within_cap" | "over_cap" | "incomplete";
  maxBytesBilledPerQuery: number;
  maxTotalBytesBilled: number;
  requestedPageCount: number;
  allowedPageCount: number;
  pageBudgetLimited: boolean;
  estimatedPagesBytes: number;
  possiblePagesEstimatedBytes: number | null;
  unestimatedPageCount: number;
  incompleteReason?: "deadline" | "page_timeout";
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
  maxTotalBytesBilled = ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED,
): Promise<OnboardingJourneyCostEstimate> {
  const requestedPageCount =
    getOnboardingJourneyEventReadPageCount(maxEventRows);
  const allowedPageCount = Math.min(
    requestedPageCount,
    getOnboardingJourneyEventReadPageBudget(maxTotalBytesBilled),
  );
  const pageOffsets = Array.from(
    { length: allowedPageCount },
    (_unused, index) => index * ONBOARDING_EVENT_PAGE_ROWS,
  );
  const pages: OnboardingJourneyCostEstimate["pages"] = [];
  let incompleteReason: OnboardingJourneyCostEstimate["incompleteReason"];
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(
    () =>
      deadline.abort(
        new DOMException(
          "Onboarding cost estimate deadline exceeded",
          "AbortError",
        ),
      ),
    ONBOARDING_EVENT_READ_DEADLINE_MS,
  );
  const estimateSignal = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;

  try {
    let backend: Awaited<
      ReturnType<typeof getFirstPartyAnalyticsBackend>
    > | null = null;
    try {
      backend = await getFirstPartyAnalyticsBackend(scope, estimateSignal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!deadline.signal.aborted) throwPreparationFailure(error, signal);
    }
    if (backend && backend.sink !== "bigquery") {
      throw new OnboardingJourneyCostError("unsupported_backend");
    }
    let table: Awaited<ReturnType<typeof getFirstPartyAnalyticsTable>> | null =
      null;
    if (backend) {
      try {
        table = await getFirstPartyAnalyticsTable(
          backend.table,
          estimateSignal,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!deadline.signal.aborted) throwPreparationFailure(error, signal);
      }
    }
    if (table) {
      for (const [index, offset] of pageOffsets.entries()) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (deadline.signal.aborted) {
          incompleteReason = "deadline";
          break;
        }
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
            signal: estimateSignal,
            wrapPreparationErrors: true,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          if (deadline.signal.aborted) {
            incompleteReason = "deadline";
            break;
          }
          throw new OnboardingJourneyCostError(
            error instanceof BigQueryDryRunPreparationError
              ? "preparation_failed"
              : "dry_run_failed",
          );
        }
        if (dryRun.timedOut) {
          incompleteReason = "page_timeout";
          break;
        }
        if (dryRun.error !== null) {
          throw new OnboardingJourneyCostError("dry_run_failed");
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
    } else {
      incompleteReason = "deadline";
    }
  } finally {
    clearTimeout(deadlineTimer);
  }

  const estimatedPagesBytes = pages.reduce(
    (total, page) => total + page.estimatedBytes,
    0,
  );
  if (!Number.isSafeInteger(estimatedPagesBytes)) {
    throw new OnboardingJourneyCostError("estimate_unavailable");
  }
  const unestimatedPageCount = allowedPageCount - pages.length;
  const overCap = pages.some(
    (page) => page.estimatedBytes > ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  );
  return {
    status: overCap
      ? "over_cap"
      : unestimatedPageCount > 0
        ? "incomplete"
        : "within_cap",
    maxBytesBilledPerQuery: ONBOARDING_EVENTS_MAX_BYTES_BILLED,
    maxTotalBytesBilled,
    requestedPageCount: getOnboardingJourneyEventReadPageCount(maxEventRows),
    allowedPageCount,
    pageBudgetLimited: allowedPageCount < requestedPageCount,
    estimatedPagesBytes,
    possiblePagesEstimatedBytes:
      unestimatedPageCount === 0 ? estimatedPagesBytes : null,
    unestimatedPageCount,
    ...(incompleteReason ? { incompleteReason } : {}),
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
