import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchAnalyticsQueryCatalog: vi.fn(),
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "admin@example.test"),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/analytics-query-catalog.js", () => ({
  searchAnalyticsQueryCatalog: mocks.searchAnalyticsQueryCatalog,
}));

const { default: action } = await import("./find-data");

describe("find-data scan coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns distinct scan counts and warns when the source index is incomplete", async () => {
    mocks.searchAnalyticsQueryCatalog.mockResolvedValueOnce({
      candidates: [],
      searched: 0,
      of: 0,
      truncated: false,
      nextPage: null,
      searchedDashboardCount: 0,
      dashboardSearchTruncated: false,
      dashboardDetailHydrationTruncated: false,
      dashboardPanelReferenceSearchStatus: "available",
      dashboardPanelReferenceSearchTruncated: false,
      dashboardPanelReferenceSearched: 0,
      dashboardPanelReferenceOf: 0,
      dashboardPanelReferenceNextPage: null,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 0,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
      sourceIndexScanCoverage: {
        unsafeEntriesOmitted: 1,
        unsafeFieldsOmitted: 2,
        truncatedFields: 3,
        unresolvedTrackingCallSites: 4,
      },
    });

    const result = await action.run({ question: "workspace users" });

    expect(result).toMatchObject({
      sourceIndexScanCoverage: {
        unsafeEntriesOmitted: 1,
        unsafeFieldsOmitted: 2,
        truncatedFields: 3,
        unresolvedTrackingCallSites: 4,
      },
    });
    expect(result.guidance).toContain("1 entry was omitted by safety checks");
    expect(result.guidance).toContain("2 fields were omitted by safety checks");
    expect(result.guidance).toContain("3 fields were truncated");
    expect(result.guidance).toContain(
      "4 tracking call sites have unresolved event names",
    );
    expect(result.guidance).toContain(
      "Treat missing source-index matches as incomplete",
    );
  });

  it("keeps missing legacy scan counts unavailable instead of reporting zero", async () => {
    mocks.searchAnalyticsQueryCatalog.mockResolvedValueOnce({
      candidates: [],
      searched: 0,
      of: 0,
      truncated: false,
      nextPage: null,
      searchedDashboardCount: 0,
      dashboardSearchTruncated: false,
      dashboardDetailHydrationTruncated: false,
      dashboardPanelReferenceSearchStatus: "available",
      dashboardPanelReferenceSearchTruncated: false,
      dashboardPanelReferenceSearched: 0,
      dashboardPanelReferenceOf: 0,
      dashboardPanelReferenceNextPage: null,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 0,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
      sourceIndexScanCoverage: {
        unsafeEntriesOmitted: null,
        unsafeFieldsOmitted: null,
        truncatedFields: null,
        unresolvedTrackingCallSites: null,
      },
    });

    const result = await action.run({ question: "workspace users" });

    expect(result.sourceIndexScanCoverage).toEqual({
      unsafeEntriesOmitted: null,
      unsafeFieldsOmitted: null,
      truncatedFields: null,
      unresolvedTrackingCallSites: null,
    });
    expect(result.guidance).toContain("coverage counts are unavailable");
    expect(result.guidance).not.toContain("0 entries were omitted");
  });

  it("reports unknown scan counts alongside positive counts", async () => {
    mocks.searchAnalyticsQueryCatalog.mockResolvedValueOnce({
      candidates: [],
      searched: 0,
      of: 0,
      truncated: false,
      nextPage: null,
      searchedDashboardCount: 0,
      dashboardSearchTruncated: false,
      dashboardDetailHydrationTruncated: false,
      dashboardPanelReferenceSearchStatus: "available",
      dashboardPanelReferenceSearchTruncated: false,
      dashboardPanelReferenceSearched: 0,
      dashboardPanelReferenceOf: 0,
      dashboardPanelReferenceNextPage: null,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 0,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
      sourceIndexScanCoverage: {
        unsafeEntriesOmitted: 2,
        unsafeFieldsOmitted: 0,
        truncatedFields: 0,
        unresolvedTrackingCallSites: null,
      },
    });

    const result = await action.run({ question: "workspace users" });

    expect(result.guidance).toContain(
      "2 entries were omitted by safety checks",
    );
    expect(result.guidance).toContain("coverage counts are unavailable");
    expect(result.guidance).toContain(
      "Treat missing source-index matches as incomplete",
    );
  });

  it("warns when generated source-index references have aged past the refresh window", async () => {
    mocks.searchAnalyticsQueryCatalog.mockResolvedValueOnce({
      candidates: [],
      searched: 0,
      of: 0,
      truncated: false,
      nextPage: null,
      searchedDashboardCount: 0,
      dashboardSearchTruncated: false,
      dashboardDetailHydrationTruncated: false,
      dashboardPanelReferenceSearchStatus: "available",
      dashboardPanelReferenceSearchTruncated: false,
      dashboardPanelReferenceSearched: 0,
      dashboardPanelReferenceOf: 0,
      dashboardPanelReferenceNextPage: null,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 0,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
      sourceIndexScanCoverage: null,
      sourceIndexFreshness: {
        ageDays: 104,
        staleAfterDays: 90,
        stale: true,
      },
    });

    const result = await action.run({ question: "workspace users" });

    expect(result.sourceIndexFreshness).toEqual({
      ageDays: 104,
      staleAfterDays: 90,
      stale: true,
    });
    expect(result.guidance).toContain(
      "The generated source index is stale (104 days old; refresh threshold 90 days)",
    );
    expect(result.guidance).toContain("Use its entries only to discover leads");
  });
});
