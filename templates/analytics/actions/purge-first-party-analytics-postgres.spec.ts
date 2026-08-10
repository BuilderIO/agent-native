import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAnalyticsAdminContext = vi.fn();
const getFirstPartyAnalyticsBackend = vi.fn();
const countFirstPartyAnalyticsPostgresRows = vi.fn();
const assertFirstPartyAnalyticsBigQueryReady = vi.fn();
const getFirstPartyAnalyticsBigQueryMetrics = vi.fn();
const purgeFirstPartyAnalyticsPostgresRows = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "admin@example.com",
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext,
}));

vi.mock("../server/lib/first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend,
  assertFirstPartyAnalyticsBigQueryReady,
  getFirstPartyAnalyticsBigQueryMetrics,
}));

vi.mock("../server/lib/first-party-analytics-purge.js", () => ({
  countFirstPartyAnalyticsPostgresRows,
  purgeFirstPartyAnalyticsPostgresRows,
}));

const { default: purgeAction } =
  await import("./purge-first-party-analytics-postgres");

describe("purge-first-party-analytics-postgres action", () => {
  beforeEach(() => {
    requireAnalyticsAdminContext.mockReset();
    getFirstPartyAnalyticsBackend.mockReset();
    countFirstPartyAnalyticsPostgresRows.mockReset();
    assertFirstPartyAnalyticsBigQueryReady.mockReset();
    getFirstPartyAnalyticsBigQueryMetrics.mockReset();
    purgeFirstPartyAnalyticsPostgresRows.mockReset();
    requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.com",
      orgId: "org-1",
      role: "owner",
    });
    getFirstPartyAnalyticsBackend.mockResolvedValue({
      sink: "dual",
      table: "project.analytics.events",
      backfillCompleted: false,
    });
    countFirstPartyAnalyticsPostgresRows.mockResolvedValue({
      eventRows: 12,
      dailyRollupRows: 3,
      userDayRows: 4,
    });
    assertFirstPartyAnalyticsBigQueryReady.mockResolvedValue(undefined);
    getFirstPartyAnalyticsBigQueryMetrics.mockResolvedValue({
      eventCount: 12,
      dailyRollupRows: 3,
      firstEventDate: "2026-07-01",
      lastEventDate: "2026-08-01",
    });
  });

  it("defaults to a read-only scoped inventory", async () => {
    const result = await purgeAction.run({ dryRun: true }, {} as never);

    expect(result).toMatchObject({
      dryRun: true,
      sink: "dual",
      safeToDelete: false,
      confirmationRequired: "PURGE_FIRST_PARTY_POSTGRES_EVENTS",
    });
    expect(purgeFirstPartyAnalyticsPostgresRows).not.toHaveBeenCalled();
  });

  it("requires the exact token before a write", async () => {
    await expect(
      purgeAction.run({ dryRun: false }, {} as never),
    ).rejects.toThrow("PURGE_FIRST_PARTY_POSTGRES_EVENTS");
    expect(purgeFirstPartyAnalyticsPostgresRows).not.toHaveBeenCalled();
  });

  it("refuses a write before BigQuery cutover", async () => {
    await expect(
      purgeAction.run(
        {
          dryRun: false,
          confirm: "PURGE_FIRST_PARTY_POSTGRES_EVENTS",
        },
        {} as never,
      ),
    ).rejects.toThrow("completed the normal BigQuery cutover");
  });

  it("requires parity before deleting scoped Postgres rows", async () => {
    getFirstPartyAnalyticsBackend.mockResolvedValue({
      sink: "bigquery",
      table: "project.analytics.events",
      backfillCompleted: true,
    });
    getFirstPartyAnalyticsBigQueryMetrics.mockResolvedValue({
      eventCount: 11,
      dailyRollupRows: 3,
      firstEventDate: "2026-07-01",
      lastEventDate: "2026-08-01",
    });

    await expect(
      purgeAction.run(
        {
          dryRun: false,
          confirm: "PURGE_FIRST_PARTY_POSTGRES_EVENTS",
        },
        {} as never,
      ),
    ).rejects.toThrow("1 scoped event rows are not present in BigQuery");
    expect(purgeFirstPartyAnalyticsPostgresRows).not.toHaveBeenCalled();
  });

  it("deletes only after cutover, parity, confirmation, and approval", async () => {
    getFirstPartyAnalyticsBackend.mockResolvedValue({
      sink: "bigquery",
      table: "project.analytics.events",
      backfillCompleted: true,
    });
    purgeFirstPartyAnalyticsPostgresRows.mockResolvedValue({
      eventRows: 12,
      dailyRollupRows: 3,
      userDayRows: 4,
    });

    const result = await purgeAction.run(
      {
        dryRun: false,
        confirm: "PURGE_FIRST_PARTY_POSTGRES_EVENTS",
      },
      {} as never,
    );

    expect(purgeFirstPartyAnalyticsPostgresRows).toHaveBeenCalledWith(
      { userEmail: "admin@example.com", orgId: "org-1" },
      false,
      expect.objectContaining({ startEventDate: expect.any(String) }),
    );
    expect(result).toMatchObject({ dryRun: false, deleted: { eventRows: 12 } });
  });
});
