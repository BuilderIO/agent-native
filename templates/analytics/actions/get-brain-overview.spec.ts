import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOrgSettings: vi.fn(),
  statusRun: vi.fn(),
  listSourceIndexRuns: vi.fn(),
  readSourceIndex: vi.fn(),
  readIndexSchedule: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/settings", () => ({
  listOrgSettings: mocks.listOrgSettings,
}));

vi.mock("./data-source-status.js", () => ({
  default: { run: mocks.statusRun },
}));

vi.mock("../server/lib/index-schedule.js", () => ({
  readIndexSchedule: mocks.readIndexSchedule,
}));

vi.mock("../server/lib/source-index-runs.js", () => ({
  listSourceIndexRuns: mocks.listSourceIndexRuns,
  requireSourceIndexReadOrg: () => "org_1",
  SOURCE_INDEX_RUN_STALE_AFTER_MS: 30 * 60 * 1000,
}));

vi.mock("../server/lib/source-index-store.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/source-index-store")
  >()),
  readSourceIndex: mocks.readSourceIndex,
}));

const { default: action } = await import("./get-brain-overview");

const SCHEDULE = {
  enabled: false,
  cron: "0 6 * * *",
  timezone: "UTC",
  automationName: null,
};

const HOUR_MS = 60 * 60 * 1000;

describe("get-brain-overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOrgSettings.mockResolvedValue({
      "data-dict-a": {},
      "data-dict-b": {},
    });
    mocks.readIndexSchedule.mockResolvedValue(SCHEDULE);
    mocks.statusRun.mockResolvedValue({
      providers: [
        {
          provider: "github",
          configured: true,
          configuredKeys: [],
          missingRequiredKeys: [],
          optionalKeys: [],
        },
      ],
      workspaceConnections: {
        appId: "analytics",
        available: true,
        error: null,
        providers: [],
      },
    });
    mocks.listSourceIndexRuns.mockResolvedValue([]);
    mocks.readSourceIndex.mockResolvedValue({ status: "not-configured" });
  });

  it("reports not-built, per-source health from the status logic, and the dictionary count", async () => {
    const overview = await action.run();

    expect(overview.index).toEqual({
      state: "not-built",
      entryCount: 0,
      generatedAt: null,
      lastRun: null,
    });
    expect(overview.dictionary).toEqual({ entryCount: 2 });
    expect(overview.schedule).toEqual(SCHEDULE);
    // dbt and Sigma have no server-side check, so they report not-connected.
    expect(overview.sources.map((s) => [s.id, s.status])).toEqual([
      ["github", "connected"],
      ["dbt", "not-connected"],
      ["bigquery", "not-connected"],
      ["amplitude", "not-connected"],
      ["sigma", "not-connected"],
    ]);
  });

  it("reports current for a fresh index with no failed run", async () => {
    const generatedAt = new Date().toISOString();
    mocks.readSourceIndex.mockResolvedValue({
      status: "available",
      bundle: {
        generatedAt,
        entries: [{}, {}, {}],
        sources: [{ id: "analytics-dbt", revision: "a".repeat(40) }],
      },
    });

    const overview = await action.run();

    expect(overview.index).toMatchObject({
      state: "current",
      entryCount: 3,
      generatedAt,
    });
  });

  it("reports failed when the latest run failed, even with an index on hand", async () => {
    mocks.readSourceIndex.mockResolvedValue({
      status: "available",
      bundle: {
        generatedAt: new Date().toISOString(),
        entries: [{}],
        sources: [{ id: "analytics-dbt", revision: "a".repeat(40) }],
      },
    });
    mocks.listSourceIndexRuns.mockResolvedValue([
      {
        id: "run_1",
        status: "failed",
        startedAt: new Date().toISOString(),
        error: "GitHub read repository file failed with HTTP 500.",
      },
    ]);

    const overview = await action.run();

    expect(overview.index.state).toBe("failed");
    expect(overview.index.lastRun?.status).toBe("failed");
  });

  it("reports an abandoned running build as failed rather than in flight", async () => {
    mocks.listSourceIndexRuns.mockResolvedValue([
      {
        id: "run_2",
        status: "running",
        startedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
      },
    ]);

    const overview = await action.run();

    expect(overview.index.state).toBe("failed");
  });

  it("reports every source as error when the status check itself throws", async () => {
    mocks.statusRun.mockRejectedValue(new Error("database unavailable"));

    const overview = await action.run();

    expect(overview.sources.every((s) => s.status === "error")).toBe(true);
    expect(overview.sources[0]?.detail).toBe("Status check failed.");
  });
});
