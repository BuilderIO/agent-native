import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "admin@example.test"),
  requireAnalyticsAdminContext: vi.fn(async () => ({ orgId: "org_test" })),
  putOrgSetting: vi.fn(),
  invalidateSourceIndexCache: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  putOrgSetting: mocks.putOrgSetting,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.requireAnalyticsAdminContext,
}));

vi.mock("../server/lib/source-index-store.js", () => ({
  invalidateSourceIndexCache: mocks.invalidateSourceIndexCache,
  SOURCE_INDEX_SETTING_KEY: "analytics-source-index-v1",
}));

const { default: action } = await import("./import-data-dictionary-index");

function sourceIndexBundle(scanSummary?: {
  unsafeEntriesOmitted: number;
  unsafeFieldsOmitted: number;
  truncatedFields: number;
}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-09T00:00:00.000Z",
    sources: [{ id: "dbt", revision: "abcdef123456" }],
    entries: [
      {
        id: "active_users",
        metric: "active users",
        definition: "Example definition",
        source: "dbt",
      },
    ],
    ...(scanSummary ? { scanSummary } : {}),
  };
}

describe("import-data-dictionary-index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports unavailable scan counts instead of inventing zero omissions", async () => {
    const result = await action.run(
      { bundle: sourceIndexBundle() },
      {} as never,
    );

    expect(result).toMatchObject({
      entryCount: 1,
      scanSummary: null,
      message: expect.stringContaining(
        "Scan quality counts are unavailable for this bundle",
      ),
    });
    expect(result.message).not.toContain("0 unsafe entries");
  });

  it("reports scan counts when the bundle includes them", async () => {
    const result = await action.run(
      {
        bundle: sourceIndexBundle({
          unsafeEntriesOmitted: 2,
          unsafeFieldsOmitted: 3,
          truncatedFields: 4,
        }),
      },
      {} as never,
    );

    expect(result).toMatchObject({
      scanSummary: {
        unsafeEntriesOmitted: 2,
        unsafeFieldsOmitted: 3,
        truncatedFields: 4,
      },
      message: expect.stringContaining("omitted 2 unsafe entries"),
    });
  });
});
