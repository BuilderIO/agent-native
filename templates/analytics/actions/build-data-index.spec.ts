import { beforeEach, describe, expect, it, vi } from "vitest";

const SHA = "a".repeat(40);

const mocks = vi.hoisted(() => ({
  requireAnalyticsAdminContext: vi.fn(),
  getRequestOrgId: vi.fn(() => "org_1"),
  getRequestUserEmail: vi.fn(() => "admin@example.test"),
  getOrgSetting: vi.fn(),
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
  putOrgSetting: mocks.putOrgSetting,
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

vi.mock("../server/lib/source-index-store.js", () => ({
  invalidateSourceIndexCache: mocks.invalidateSourceIndexCache,
  SOURCE_INDEX_SETTING_KEY: "analytics-source-index",
}));

const { default: action } = await import("./build-data-index");

const bundle = {
  entries: [{ id: "a" }, { id: "b" }],
  sources: [
    { id: "analytics-dbt", revision: SHA, contentFingerprint: "b".repeat(64) },
  ],
};

describe("build-data-index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.test",
      orgId: "org_1",
      role: "owner",
    });
    mocks.getOrgSetting.mockResolvedValue({
      owner: "acme",
      repo: "analytics-dbt",
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
