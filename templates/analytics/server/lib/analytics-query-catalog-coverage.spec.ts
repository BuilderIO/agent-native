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
  sources: [
    {
      id: "dbt",
      revision: "abcdef123456",
      generatedAt: "2026-10-09T00:00:00.000Z",
    },
  ],
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
    expect(result.sourceIndexSourcesFreshness).toEqual({
      sourceCount: 1,
      unknownTimestampCount: 0,
      staleSourceCount: 0,
      fresh: true,
    });
  });

  it("fails closed when a source has no independent generation timestamp", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: {
        ...baseBundle,
        sources: [{ id: "dbt", revision: "abcdef123456" }],
      },
    });

    const result = await searchAnalyticsDictionaryCatalog({
      search: "workspace members",
      email: "admin@example.test",
      orgId: "org_test",
      limit: 8,
    });

    expect(result.sourceIndexSourcesFreshness).toEqual({
      sourceCount: 1,
      unknownTimestampCount: 1,
      staleSourceCount: 0,
      fresh: false,
    });
    expect(result.candidates[0]).toMatchObject({
      origin: "source-index",
      sourceIndexStale: true,
      sourceIndexFreshnessUnknown: true,
    });
    expect(result.candidates[0]).not.toHaveProperty("sourceIndexGeneratedAt");
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

  it("reports a stale preserved source even when the bundle is fresh", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: {
        ...baseBundle,
        generatedAt: "2026-10-12T00:00:00.000Z",
        sources: [
          {
            id: "dbt",
            revision: "abcdef123456",
            generatedAt: "2026-10-12T00:00:00.000Z",
          },
          {
            id: "preserved-code",
            contentFingerprint: "c".repeat(64),
            generatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });

    const result = await searchAnalyticsDictionaryCatalog({
      search: "workspace members",
      email: "admin@example.test",
      orgId: "org_test",
      limit: 8,
    });

    expect(result.sourceIndexFreshness).toMatchObject({ stale: false });
    expect(result.sourceIndexSourcesFreshness).toEqual({
      sourceCount: 2,
      unknownTimestampCount: 0,
      staleSourceCount: 1,
      fresh: false,
    });
  });
});
