import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dryRun: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  backend: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "admin@example.com",
  getRequestOrgId: () => "org-1",
}));
vi.mock("../server/lib/bigquery.js", () => ({
  dryRunQuerySchema: mocks.dryRun,
}));
vi.mock("../server/lib/source-generation.js", () => ({
  resolveSourceGeneration: mocks.resolve,
}));
vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.admin,
}));
vi.mock("../server/lib/first-party-analytics-backend.js", () => ({
  firstPartyEventsModelProjection: (table: string) =>
    `SELECT event_id AS id FROM \`${table}\``,
  getFirstPartyAnalyticsBackend: mocks.backend,
  saveFirstPartyEventsModelTable: mocks.save,
}));

const { default: action } =
  await import("./configure-first-party-events-model");

const MODEL = "example-project.dbt_mart.fact_events";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.admin.mockResolvedValue({
    userEmail: "admin@example.com",
    orgId: "org-1",
    role: "admin",
  });
  mocks.resolve.mockResolvedValue({
    status: "ok",
    sources: [],
    generation: `${MODEL}@1`,
    oldestModifiedAt: "2026-10-16T11:00:00.000Z",
    ageMs: 3_600_000,
    stale: false,
    checkedAt: "2026-10-16T12:00:00.000Z",
  });
  mocks.dryRun.mockResolvedValue({ error: null, totalBytesProcessed: 1024 });
});

describe("configure-first-party-events-model", () => {
  it("checks with dry runs only and saves nothing", async () => {
    await expect(
      action.run({ mode: "check", table: MODEL }, {} as never),
    ).resolves.toMatchObject({
      status: "ok",
      table: MODEL,
      recentDayBytes: 1024,
      fullScanBytes: 1024,
    });
    expect(mocks.dryRun).toHaveBeenCalledTimes(2);
    expect(mocks.dryRun.mock.calls[0]![0]).toContain(`\`${MODEL}\``);
    for (const [sql] of mocks.dryRun.mock.calls) {
      expect(sql).toMatch(/^SELECT \* FROM /);
    }
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("reports a model the app cannot see without dry-running it", async () => {
    mocks.resolve.mockResolvedValue({
      status: "unavailable",
      sources: [],
      reason: "access_denied",
      checkedAt: "2026-10-16T12:00:00.000Z",
    });

    await expect(
      action.run({ mode: "check", table: MODEL }, {} as never),
    ).resolves.toEqual({
      status: "unavailable",
      table: MODEL,
      reason: "access_denied",
    });
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });

  it("refuses to save a model the app cannot query", async () => {
    mocks.dryRun.mockResolvedValue({ error: "Access Denied: Table" });

    await expect(
      action.run({ mode: "set", table: MODEL }, {} as never),
    ).rejects.toThrow("the model was not saved");
    expect(mocks.admin).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses to save a model that rejects an unbounded read", async () => {
    mocks.dryRun
      .mockResolvedValueOnce({ error: null, totalBytesProcessed: 1024 })
      .mockResolvedValueOnce({
        error: "Cannot query over table without a filter over column(s)",
      });

    await expect(
      action.run({ mode: "set", table: MODEL }, {} as never),
    ).rejects.toThrow("full_read_denied");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves a model that passes the check", async () => {
    await expect(
      action.run({ mode: "set", table: MODEL }, {} as never),
    ).resolves.toMatchObject({ status: "saved", table: MODEL });
    expect(mocks.save).toHaveBeenCalledWith(
      { userEmail: "admin@example.com", orgId: "org-1", role: "admin" },
      MODEL,
    );
  });

  it("rejects a table that is not project.dataset.table", async () => {
    await expect(
      action.run({ mode: "set", table: "dbt_mart.fact_events" }, {} as never),
    ).rejects.toThrow("project.dataset.table");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
