import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(async () => null),
  getOrgSetting: vi.fn(async () => null),
  listOrgSettings: vi.fn(async () => ({})),
  listSettingsByPrefix: vi.fn(async () => []),
  readSourceIndex: vi.fn(),
  sourceIndexFreshness: vi.fn(() => ({
    ageDays: 0,
    staleAfterDays: 90,
    stale: false,
  })),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  getOrgSetting: mocks.getOrgSetting,
  listOrgSettings: mocks.listOrgSettings,
  listSettingsByPrefix: mocks.listSettingsByPrefix,
}));

vi.mock("./source-index-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./source-index-store")>()),
  readSourceIndex: mocks.readSourceIndex,
  sourceIndexFreshness: mocks.sourceIndexFreshness,
}));

const { searchAnalyticsDictionaryCatalog } =
  await import("./analytics-query-catalog");

const baseBundle = {
  schemaVersion: 1 as const,
  generatedAt: "2026-10-09T00:00:00.000Z",
  sources: [{ id: "dbt", revision: "abcdef123456" }],
  entries: [
    {
      id: "workspace-members",
      metric: "Workspace members",
      definition: "One row per user-workspace membership.",
      source: "dbt",
      sourceKind: "dbt" as const,
      entryType: "model" as const,
      grain: "One row per user-workspace membership",
      table: "workspace_members",
    },
  ],
};

describe("analytics query catalog scan coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves all scan counts for the generated source index", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: {
        ...baseBundle,
        scanSummary: {
          unsafeEntriesOmitted: 1,
          unsafeFieldsOmitted: 2,
          truncatedFields: 3,
          unresolvedTrackingCallSites: 4,
        },
      },
    });

    const result = await searchAnalyticsDictionaryCatalog({
      search: "workspace members",
      email: "admin@example.test",
      orgId: "org_test",
      limit: 8,
    });

    expect(result.sourceIndexStatus).toBe("available");
    expect(result.sourceIndexScanCoverage).toEqual({
      unsafeEntriesOmitted: 1,
      unsafeFieldsOmitted: 2,
      truncatedFields: 3,
      unresolvedTrackingCallSites: 4,
    });
  });

  it("keeps scan counts unavailable for legacy indexes without a summary", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: baseBundle,
    });

    const result = await searchAnalyticsDictionaryCatalog({
      search: "workspace members",
      email: "admin@example.test",
      orgId: "org_test",
      limit: 8,
    });

    expect(result.sourceIndexStatus).toBe("available");
    expect(result.sourceIndexScanCoverage).toEqual({
      unsafeEntriesOmitted: null,
      unsafeFieldsOmitted: null,
      truncatedFields: null,
      unresolvedTrackingCallSites: null,
    });
  });

  it("returns freshness metadata and stamps generated candidates", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: baseBundle,
    });
    mocks.sourceIndexFreshness.mockReturnValueOnce({
      ageDays: 104,
      staleAfterDays: 90,
      stale: true,
    });

    const result = await searchAnalyticsDictionaryCatalog({
      search: "workspace members",
      email: "admin@example.test",
      orgId: "org_test",
      limit: 8,
    });

    expect(result.sourceIndexFreshness).toEqual({
      ageDays: 104,
      staleAfterDays: 90,
      stale: true,
    });
    expect(result.candidates[0]).toMatchObject({
      origin: "source-index",
      sourceIndexStale: true,
      sourceIndexAgeDays: 104,
      sourceIndexStaleAfterDays: 90,
    });
  });
});
