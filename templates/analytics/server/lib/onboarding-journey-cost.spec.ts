import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dryRunQuerySchema: vi.fn(),
  BigQueryDryRunPreparationError: class BigQueryDryRunPreparationError extends Error {
    constructor() {
      super("BigQuery dry-run request preparation failed");
      this.name = "BigQueryDryRunPreparationError";
    }
  },
  getFirstPartyAnalyticsBackend: vi.fn(),
  getFirstPartyAnalyticsTable: vi.fn(),
  renderFirstPartyAnalyticsBigQueryRequestSql: vi.fn(),
  scopedAnalyticsSql: vi.fn(),
}));

vi.mock("./bigquery.js", () => ({
  dryRunQuerySchema: mocks.dryRunQuerySchema,
  BigQueryDryRunPreparationError: mocks.BigQueryDryRunPreparationError,
}));

vi.mock("./first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: mocks.getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsTable: mocks.getFirstPartyAnalyticsTable,
  renderFirstPartyAnalyticsBigQueryRequestSql:
    mocks.renderFirstPartyAnalyticsBigQueryRequestSql,
}));

vi.mock("./first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: vi.fn(),
  scopedAnalyticsSql: mocks.scopedAnalyticsSql,
  FirstPartyAnalyticsQueryTimeoutError: class FirstPartyAnalyticsQueryTimeoutError extends Error {},
}));

import type {
  OnboardingJourneyEventsFilters,
  OnboardingJourneyObservationWindow,
} from "./first-party-metric-catalog.js";
import {
  estimateOnboardingJourneyEventQueryCost,
  OnboardingJourneyCostError,
} from "./onboarding-journey-cost.js";

const scope = { userEmail: "caller@example.test", orgId: "org-1" };
const filters: OnboardingJourneyEventsFilters = {
  dateFrom: "2026-10-01",
  dateTo: "2026-10-02",
  app: "clips",
  emailFilter: "exclude_builder",
};
const observation: OnboardingJourneyObservationWindow = {
  observationCutoff: "2026-10-10T12:00:00.000Z",
  observationDate: "2026-10-10",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFirstPartyAnalyticsBackend.mockResolvedValue({
    sink: "bigquery",
    table: "private-configured-table",
  });
  mocks.getFirstPartyAnalyticsTable.mockResolvedValue({
    projectId: "private-project",
    datasetId: "private-dataset",
    tableId: "private-table",
    fullyQualified: "private-project.private-dataset.private-table",
  });
  mocks.scopedAnalyticsSql.mockReturnValue({
    sql: "private scoped SQL",
    args: ["private-scope-value"],
  });
  mocks.renderFirstPartyAnalyticsBigQueryRequestSql.mockReturnValue(
    "private rendered SQL",
  );
  mocks.dryRunQuerySchema.mockResolvedValue({
    error: null,
    totalBytesProcessed: 700,
  });
});

describe("estimateOnboardingJourneyEventQueryCost", () => {
  it("dry-runs the possible production pages and returns only byte estimates", async () => {
    const signal = new AbortController().signal;
    const estimate = await estimateOnboardingJourneyEventQueryCost(
      scope,
      filters,
      4_000,
      observation,
      false,
      signal,
    );

    expect(estimate).toEqual({
      status: "within_cap",
      maxBytesBilledPerQuery: 25_000_000_000,
      possiblePagesEstimatedBytes: 1_400,
      pages: [
        { page: 1, offset: 0, estimatedBytes: 700 },
        { page: 2, offset: 4_000, estimatedBytes: 700 },
      ],
    });
    expect(mocks.dryRunQuerySchema).toHaveBeenCalledTimes(2);
    expect(mocks.dryRunQuerySchema).toHaveBeenNthCalledWith(
      1,
      "private rendered SQL",
      { signal, wrapPreparationErrors: true },
    );
    expect(mocks.scopedAnalyticsSql).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 4000 OFFSET 0"),
      scope,
      undefined,
      {
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
      },
    );
    expect(mocks.scopedAnalyticsSql).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("LIMIT 1 OFFSET 4000"),
      scope,
      undefined,
      {
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
      },
    );
    expect(
      mocks.renderFirstPartyAnalyticsBigQueryRequestSql,
    ).toHaveBeenCalledWith(
      "private scoped SQL",
      ["private-scope-value"],
      expect.any(Object),
      {
        eventDateRange: { startDate: "2026-10-01", endDate: "2026-10-02" },
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
      },
    );
    expect(JSON.stringify(estimate)).not.toContain("private");
  });

  it("does not report a missing byte estimate as a successful zero", async () => {
    mocks.dryRunQuerySchema.mockResolvedValueOnce({ error: null });

    await expect(
      estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        1_000,
        observation,
        false,
      ),
    ).rejects.toMatchObject({
      name: "OnboardingJourneyCostError",
      code: "estimate_unavailable",
    });
  });

  it("drops private BigQuery error details from failures", async () => {
    const privateProviderError = "private SQL and provider response";
    mocks.dryRunQuerySchema.mockResolvedValueOnce({
      error: privateProviderError,
    });

    let failure: unknown;
    try {
      await estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        1_000,
        observation,
        false,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OnboardingJourneyCostError);
    expect(failure).toMatchObject({ code: "dry_run_failed" });
    expect((failure as Error).message).not.toContain(privateProviderError);
  });

  it("classifies thrown BigQuery preparation errors separately", async () => {
    mocks.dryRunQuerySchema.mockRejectedValueOnce(
      new mocks.BigQueryDryRunPreparationError(),
    );

    await expect(
      estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        1_000,
        observation,
        false,
      ),
    ).rejects.toMatchObject({ code: "preparation_failed" });
  });

  it("classifies unknown thrown request errors as BigQuery dry-run failures", async () => {
    const privateNetworkError = "private BigQuery request response detail";
    mocks.dryRunQuerySchema.mockRejectedValueOnce(
      new Error(privateNetworkError),
    );

    let failure: unknown;
    try {
      await estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        1_000,
        observation,
        false,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "dry_run_failed" });
    expect((failure as Error).message).not.toContain(privateNetworkError);
  });

  it.each([
    [
      "backend lookup",
      () =>
        mocks.getFirstPartyAnalyticsBackend.mockRejectedValueOnce(
          new Error("private backend detail"),
        ),
    ],
    [
      "table lookup",
      () =>
        mocks.getFirstPartyAnalyticsTable.mockRejectedValueOnce(
          new Error("private table detail"),
        ),
    ],
    [
      "scope preparation",
      () =>
        mocks.scopedAnalyticsSql.mockImplementationOnce(() => {
          throw new Error("private scope detail");
        }),
    ],
    [
      "SQL rendering",
      () =>
        mocks.renderFirstPartyAnalyticsBigQueryRequestSql.mockImplementationOnce(
          () => {
            throw new Error("private render detail");
          },
        ),
    ],
  ] as const)(
    "classifies %s errors as estimate preparation failures",
    async (_label, failAt) => {
      failAt();

      let failure: unknown;
      try {
        await estimateOnboardingJourneyEventQueryCost(
          scope,
          filters,
          1_000,
          observation,
          false,
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(OnboardingJourneyCostError);
      expect(failure).toMatchObject({ code: "preparation_failed" });
      expect((failure as Error).message).not.toContain("private");
      expect(mocks.dryRunQuerySchema).not.toHaveBeenCalled();
    },
  );

  it("fails closed for non-BigQuery backends", async () => {
    mocks.getFirstPartyAnalyticsBackend.mockResolvedValueOnce({
      sink: "postgres",
      table: null,
    });

    await expect(
      estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        1_000,
        observation,
        false,
      ),
    ).rejects.toMatchObject({
      code: "unsupported_backend",
    });
    expect(mocks.dryRunQuerySchema).not.toHaveBeenCalled();
  });
});
