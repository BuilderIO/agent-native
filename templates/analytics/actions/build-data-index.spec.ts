import { beforeEach, describe, expect, it, vi } from "vitest";

const SHA = "a".repeat(40);

const mocks = vi.hoisted(() => ({
  requireAnalyticsAdminContext: vi.fn(),
  getRequestOrgId: vi.fn(() => "org_1"),
  getRequestUserEmail: vi.fn(() => "admin@example.test"),
  getOrgSetting: vi.fn(),
  mutateOrgSetting: vi.fn(),
  putOrgSetting: vi.fn(),
  build: vi.fn(),
  createSourceIndexRun: vi.fn(),
  finishSourceIndexRun: vi.fn(),
  listSourceIndexRuns: vi.fn(),
  invalidateSourceIndexCache: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: object) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  mutateOrgSetting: mocks.mutateOrgSetting,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.requireAnalyticsAdminContext,
}));

vi.mock("../server/lib/index-build-github.js", async () => {
  const { z } = await import("zod");
  return {
    DBT_REPOSITORY_SETTING_KEY: "analytics-dbt-repository",
    dbtRepositorySettingSchema: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
    buildDbtSourceIndexFromGitHub: mocks.build,
  };
});

vi.mock("../server/lib/source-index-runs.js", () => ({
  createSourceIndexRun: mocks.createSourceIndexRun,
  finishSourceIndexRun: mocks.finishSourceIndexRun,
  listSourceIndexRuns: mocks.listSourceIndexRuns,
  SOURCE_INDEX_RUN_STALE_AFTER_MS: 30 * 60 * 1000,
}));

vi.mock("../server/lib/source-index-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/source-index-store.js")
  >("../server/lib/source-index-store.js");
  return {
    ...actual,
    invalidateSourceIndexCache: mocks.invalidateSourceIndexCache,
    SOURCE_INDEX_SETTING_KEY: "analytics-source-index",
  };
});

const { default: action } = await import("./build-data-index");

const bundle = {
  schemaVersion: 1,
  generatedAt: "2026-10-12T00:00:00.000Z",
  sources: [
    {
      id: "analytics-dbt",
      sourceKind: "dbt",
      repositoryRef: "acme/analytics-dbt",
      revision: SHA,
      contentFingerprint: "b".repeat(64),
      generatedAt: "2026-10-12T00:00:00.000Z",
    },
  ],
  entries: [
    {
      id: "active-users",
      metric: "active users",
      definition: "A source-index definition.",
      source: "analytics-dbt",
      sourceKind: "dbt",
      sourceRevision: SHA,
    },
    {
      id: "active-organizations",
      metric: "active organizations",
      definition: "Another source-index definition.",
      source: "analytics-dbt",
      sourceKind: "dbt",
      sourceRevision: SHA,
    },
  ],
  scanSummary: {
    unsafeEntriesOmitted: 0,
    unsafeFieldsOmitted: 0,
    truncatedFields: 0,
    unresolvedTrackingCallSites: 0,
  },
};

describe("build-data-index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.test",
      orgId: "org_1",
      role: "owner",
    });
    mocks.getOrgSetting.mockImplementation(async (_orgId, key) =>
      key === "analytics-dbt-repository"
        ? { owner: "acme", repo: "analytics-dbt" }
        : null,
    );
    mocks.mutateOrgSetting.mockImplementation(async (orgId, key, updater) => {
      const current = await mocks.getOrgSetting(orgId, key);
      const next = await updater(current);
      mocks.putOrgSetting(orgId, key, next);
      return next;
    });
    mocks.listSourceIndexRuns.mockResolvedValue([]);
    mocks.createSourceIndexRun.mockResolvedValue({
      id: "run_1",
      status: "running",
    });
    mocks.finishSourceIndexRun.mockImplementation(
      async (id: string, _org: string, outcome: { status: string }) => ({
        id,
        status: outcome.status,
      }),
    );
    mocks.build.mockResolvedValue({ bundle, revision: SHA });
  });

  it("rejects a non-admin before creating a run or writing the index", async () => {
    mocks.requireAnalyticsAdminContext.mockRejectedValue(
      Object.assign(
        new Error(
          "Only organization owners and admins can use Analytics admin tools.",
        ),
        { statusCode: 403 },
      ),
    );

    await expect(action.run({ trigger: "manual" })).rejects.toThrow(
      "owners and admins",
    );
    expect(mocks.createSourceIndexRun).not.toHaveBeenCalled();
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("stores the bundle and marks the run succeeded with its revisions", async () => {
    await expect(action.run({ trigger: "manual" })).resolves.toEqual({
      id: "run_1",
      status: "succeeded",
    });

    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org_1",
      "analytics-source-index",
      bundle,
    );
    expect(mocks.invalidateSourceIndexCache).toHaveBeenCalledWith("org_1");
    expect(mocks.finishSourceIndexRun).toHaveBeenCalledWith("run_1", "org_1", {
      status: "succeeded",
      entryCount: 2,
      sourceRevisions: { "analytics-dbt": SHA },
    });
  });

  it("replaces only rebuilt dbt sources and preserves imported source entries", async () => {
    const current = {
      schemaVersion: 1,
      generatedAt: "2026-10-01T00:00:00.000Z",
      sources: [
        {
          id: "analytics-dbt",
          sourceKind: "dbt",
          repositoryRef: "acme/analytics-dbt",
          revision: "c".repeat(40),
          contentFingerprint: "d".repeat(64),
          generatedAt: "2026-10-01T00:00:00.000Z",
        },
        { id: "builder-internal", revision: "e".repeat(40) },
        { id: "analytics-sigma", contentFingerprint: "f".repeat(64) },
      ],
      entries: [
        {
          id: "stale-dbt-entry",
          metric: "stale dbt entry",
          definition: "Replaced with the newly built dbt source.",
          source: "analytics-dbt",
          sourceKind: "dbt",
        },
        {
          id: "code-event",
          metric: "code event",
          definition: "Retained from tracking code.",
          source: "builder-internal",
          sourceKind: "code",
        },
        {
          id: "sigma-example",
          metric: "Sigma example",
          definition: "Retained as a reviewed example.",
          source: "analytics-sigma",
          sourceKind: "sigma",
        },
      ],
      scanSummary: {
        unsafeEntriesOmitted: 2,
        unsafeFieldsOmitted: 3,
        truncatedFields: 4,
        unresolvedTrackingCallSites: 5,
      },
    };
    mocks.getOrgSetting.mockImplementation(async (_orgId, key) =>
      key === "analytics-dbt-repository"
        ? { owner: "acme", repo: "analytics-dbt" }
        : current,
    );

    await action.run({ trigger: "manual" });

    const stored = mocks.putOrgSetting.mock.calls[0]?.[2];
    expect(stored).toMatchObject({
      generatedAt: "2026-10-12T00:00:00.000Z",
      sources: [
        { id: "builder-internal", generatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "analytics-sigma", generatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "analytics-dbt", revision: SHA, generatedAt: bundle.generatedAt },
      ],
      entries: [
        { id: "code-event", source: "builder-internal" },
        { id: "sigma-example", source: "analytics-sigma" },
        { id: "active-users", source: "analytics-dbt" },
        { id: "active-organizations", source: "analytics-dbt" },
      ],
    });
    expect(stored.entries).not.toContainEqual(
      expect.objectContaining({ id: "stale-dbt-entry" }),
    );
    expect(stored).not.toHaveProperty("scanSummary");
    expect(mocks.finishSourceIndexRun).toHaveBeenCalledWith(
      "run_1",
      "org_1",
      expect.objectContaining({
        sourceRevisions: { "analytics-dbt": SHA },
      }),
    );
  });

  it("keeps the current index and records the error when the build throws", async () => {
    mocks.build.mockRejectedValue(
      new Error("GitHub read repository file failed with HTTP 500."),
    );

    await expect(action.run({ trigger: "manual" })).rejects.toThrow("HTTP 500");
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
    expect(mocks.finishSourceIndexRun).toHaveBeenCalledWith("run_1", "org_1", {
      status: "failed",
      error: "GitHub read repository file failed with HTTP 500.",
    });
  });

  it("keeps an invalid current index untouched instead of replacing it", async () => {
    mocks.getOrgSetting.mockImplementation(async (_orgId, key) =>
      key === "analytics-dbt-repository"
        ? { owner: "acme", repo: "analytics-dbt" }
        : {
            schemaVersion: 1,
            generatedAt: "invalid",
            sources: [],
            entries: [],
          },
    );

    await expect(action.run({ trigger: "manual" })).rejects.toThrow(
      "Analytics source index is invalid",
    );
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
    expect(mocks.finishSourceIndexRun).toHaveBeenCalledWith("run_1", "org_1", {
      status: "failed",
      error: expect.stringContaining("Analytics source index is invalid"),
    });
  });

  it("refuses to start while another build is still running", async () => {
    mocks.listSourceIndexRuns.mockResolvedValue([
      { id: "run_0", status: "running", startedAt: new Date().toISOString() },
    ]);

    await expect(action.run({ trigger: "manual" })).rejects.toMatchObject({
      errorCode: "source_index_build_running",
    });
    expect(mocks.createSourceIndexRun).not.toHaveBeenCalled();
  });

  it("stops before creating a run when no dbt repository is configured", async () => {
    mocks.getOrgSetting.mockResolvedValue(null);

    await expect(action.run({ trigger: "manual" })).rejects.toMatchObject({
      errorCode: "dbt_repository_not_configured",
    });
    expect(mocks.createSourceIndexRun).not.toHaveBeenCalled();
  });
});
