import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSourceIndex: vi.fn(),
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

vi.mock("../server/lib/source-index-store.js", () => ({
  readSourceIndex: mocks.readSourceIndex,
  sourceIndexFreshness: () => ({
    ageDays: 3,
    staleAfterDays: 90,
    stale: false,
  }),
}));

const { default: action } = await import("./get-data-dictionary-index-status");

describe("get-data-dictionary-index-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns freshness and entry counts for each indexed source", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: {
        generatedAt: "2026-10-06T00:00:00.000Z",
        sources: [
          { id: "dbt", revision: "abcdef123456" },
          { id: "builder-internal", contentFingerprint: "a".repeat(64) },
          { id: "ai-services", contentFingerprint: "b".repeat(64) },
        ],
        entries: [
          { source: "dbt" },
          { source: "dbt" },
          { source: "builder-internal" },
        ],
        scanSummary: { unresolvedTrackingCallSites: 3 },
      },
    });

    await expect(action.run()).resolves.toEqual({
      status: "available",
      generatedAt: "2026-10-06T00:00:00.000Z",
      entryCount: 3,
      unresolvedTrackingCallSites: 3,
      sources: [
        { id: "dbt", revision: "abcdef123456" },
        { id: "builder-internal", contentFingerprint: "a".repeat(64) },
        { id: "ai-services", contentFingerprint: "b".repeat(64) },
      ],
      sourceCounts: [
        { source: "dbt", entryCount: 2 },
        { source: "builder-internal", entryCount: 1 },
        { source: "ai-services", entryCount: 0 },
      ],
      ageDays: 3,
      staleAfterDays: 90,
      stale: false,
    });
    expect(mocks.readSourceIndex).toHaveBeenCalledWith("org_test");
  });

  it("preserves missing and invalid index states without inventing freshness", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({ status: "not-configured" });

    await expect(action.run()).resolves.toEqual({ status: "not-configured" });
  });

  it("defaults missing legacy scan counts to zero", async () => {
    mocks.readSourceIndex.mockResolvedValueOnce({
      status: "available",
      bundle: {
        generatedAt: "2026-10-06T00:00:00.000Z",
        sources: [{ id: "dbt" }],
        entries: [{ source: "dbt" }],
      },
    });

    await expect(action.run()).resolves.toMatchObject({
      status: "available",
      unresolvedTrackingCallSites: 0,
    });
  });

  it("requires an authenticated user before reading the organization index", async () => {
    mocks.getRequestUserEmail.mockReturnValueOnce("");

    await expect(action.run()).rejects.toMatchObject({
      errorCode: "authentication_required",
    });
    expect(mocks.readSourceIndex).not.toHaveBeenCalled();
  });
});
