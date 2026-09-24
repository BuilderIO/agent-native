import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getBackend: vi.fn(),
  saveBackend: vi.fn(),
  assertReady: vi.fn(),
  getJob: vi.fn(),
  queueJob: vi.fn(),
  requireAnalyticsAdminContext: vi.fn(),
  listDashboards: vi.fn(),
  assertBigQuerySql: vi.fn(),
}));

class FakeUnsupportedSqlError extends Error {
  constructor(readonly construct: string) {
    super(`unsupported: ${construct}`);
  }
}

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: mocks.getBackend,
  saveFirstPartyAnalyticsBackend: mocks.saveBackend,
  assertFirstPartyAnalyticsBigQueryReady: mocks.assertReady,
  assertFirstPartyAnalyticsBigQuerySql: mocks.assertBigQuerySql,
  FirstPartyAnalyticsUnsupportedSqlError: FakeUnsupportedSqlError,
}));
vi.mock("../server/lib/dashboards-store.js", () => ({
  listDashboards: mocks.listDashboards,
}));
vi.mock("../server/jobs/analytics-bigquery-backfill.js", () => ({
  getFirstPartyAnalyticsBigQueryBackfillJob: mocks.getJob,
  queueFirstPartyAnalyticsBigQueryBackfill: mocks.queueJob,
}));
vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.requireAnalyticsAdminContext,
}));

const { default: migrateAction } =
  await import("./migrate-first-party-analytics-to-bigquery");

const table = "builder-3b0a2.analytics.first_party_analytics_events_raw";

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.getBackend.mockReset();
  mocks.saveBackend.mockReset();
  mocks.assertReady.mockReset();
  mocks.getJob.mockReset();
  mocks.queueJob.mockReset();
  mocks.requireAnalyticsAdminContext.mockReset();
  mocks.listDashboards.mockReset();
  mocks.assertBigQuerySql.mockReset();
  mocks.listDashboards.mockResolvedValue([]);
  mocks.getRequestOrgId.mockReturnValue("org_builder");
  mocks.getRequestUserEmail.mockReturnValue("owner@builder.io");
  mocks.requireAnalyticsAdminContext.mockResolvedValue({
    userEmail: "owner@builder.io",
    orgId: "org_builder",
    role: "owner",
  });
  mocks.getBackend.mockResolvedValue({
    sink: "postgres",
    table: null,
    backfillCursor: null,
    backfillCompleted: false,
  });
  mocks.assertReady.mockResolvedValue({
    table: {
      projectId: "builder-3b0a2",
      datasetId: "analytics",
      tableId: "first_party_analytics_events_raw",
      fullyQualified: table,
    },
    rowCount: 0,
  });
  mocks.saveBackend.mockResolvedValue(undefined);
  mocks.getJob.mockResolvedValue(null);
  mocks.queueJob.mockResolvedValue({
    id: "first-party-analytics:org_builder",
    orgId: "org_builder",
    ownerEmail: "owner@builder.io",
    table,
    batchSize: 250,
    cursor: null,
    status: "pending",
    copied: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    nextRunAt: "2026-08-07T00:00:00.000Z",
    lastError: null,
    completedAt: null,
    updatedAt: "2026-08-07T00:00:00.000Z",
  });
});

describe("migrate-first-party-analytics-to-bigquery action", () => {
  it("requires an active organization", async () => {
    mocks.getRequestOrgId.mockReturnValue(null);

    await expect(migrateAction.run({ mode: "status" })).rejects.toThrow(
      "active organization",
    );
  });

  it("requires approval only for the write cutover", () => {
    expect(migrateAction.needsApproval({ mode: "cutover" })).toBe(true);
    expect(migrateAction.needsApproval({ mode: "backfill" })).toBe(false);
  });

  it("accepts a bounded worker batch without allowing unbounded input", () => {
    expect(() =>
      migrateAction.schema.parse({ mode: "backfill", limit: 750 }),
    ).not.toThrow();
    expect(() =>
      migrateAction.schema.parse({ mode: "backfill", limit: 751 }),
    ).toThrow();
  });

  it("prepares the current organization for dual-write", async () => {
    await expect(
      migrateAction.run({ mode: "prepare", table }),
    ).resolves.toMatchObject({ sink: "dual", table });

    expect(mocks.assertReady).toHaveBeenCalledWith(table);
    expect(mocks.queueJob).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      table,
      undefined,
      null,
    );
    expect(mocks.saveBackend).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      {
        sink: "dual",
        table,
        backfillCursor: null,
        backfillCompleted: false,
      },
    );
  });

  it("preserves the legacy cursor when recovering a dual-write migration", async () => {
    const legacyCursor = JSON.stringify({
      receivedAt: "2026-08-07T00:00:00.000Z",
      id: "evt_last",
    });
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: legacyCursor,
      backfillCompleted: false,
    });
    mocks.assertReady.mockResolvedValueOnce({
      table: {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified: table,
      },
      rowCount: 9_141_896,
    });

    await expect(
      migrateAction.run({ mode: "prepare", table }),
    ).resolves.toMatchObject({ sink: "dual", table });

    expect(mocks.saveBackend).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      {
        sink: "dual",
        table,
        backfillCursor: legacyCursor,
        backfillCompleted: false,
      },
    );
    expect(mocks.queueJob).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      table,
      undefined,
      legacyCursor,
    );
  });

  it("passes an explicit larger batch to an existing migration job", async () => {
    const legacyCursor = JSON.stringify({
      receivedAt: "2026-08-07T00:00:00.000Z",
      id: "evt_last",
    });
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: legacyCursor,
      backfillCompleted: false,
    });
    mocks.getJob.mockResolvedValueOnce({
      status: "pending" as const,
      table,
      cursor: legacyCursor,
    });

    await expect(
      migrateAction.run({ mode: "prepare", table, limit: 750 }),
    ).resolves.toMatchObject({ sink: "dual", table });

    expect(mocks.queueJob).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      table,
      750,
      legacyCursor,
    );
  });

  it("refuses to restart a dual-write migration with rows but no cursor", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: null,
      backfillCompleted: false,
    });
    mocks.assertReady.mockResolvedValueOnce({
      table: {
        projectId: "builder-3b0a2",
        datasetId: "analytics",
        tableId: "first_party_analytics_events_raw",
        fullyQualified: table,
      },
      rowCount: 1,
    });

    await expect(migrateAction.run({ mode: "prepare", table })).rejects.toThrow(
      "without its legacy cursor",
    );
    expect(mocks.saveBackend).not.toHaveBeenCalled();
    expect(mocks.queueJob).not.toHaveBeenCalled();
  });

  it("queues the durable backfill worker instead of running in the request", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: null,
      backfillCompleted: false,
    });
    mocks.getJob.mockResolvedValueOnce({
      status: "pending" as const,
      table,
      cursor: null,
    });

    await expect(
      migrateAction.run({ mode: "backfill", limit: 100 }),
    ).resolves.toMatchObject({ queued: true, next: "backfill", table });

    expect(mocks.queueJob).not.toHaveBeenCalled();
    expect(mocks.saveBackend).not.toHaveBeenCalled();
  });

  it("refuses cutover until the backfill is complete and confirmed", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: "evt_next",
      backfillCompleted: false,
    });
    mocks.getJob.mockResolvedValueOnce({ status: "pending" });

    await expect(migrateAction.run({ mode: "cutover" })).rejects.toThrow(
      "confirm=true",
    );
    expect(mocks.assertReady).not.toHaveBeenCalled();
    expect(mocks.saveBackend).not.toHaveBeenCalled();
  });

  it("cuts over only after the completed backfill is confirmed", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: "evt_last",
      backfillCompleted: false,
    });
    mocks.getJob.mockResolvedValueOnce({
      status: "completed",
      cursor: "evt_last",
    });

    await expect(
      migrateAction.run({ mode: "cutover", confirm: true }),
    ).resolves.toMatchObject({
      sink: "bigquery",
      table,
      postgresEventWrites: "stopped",
    });

    expect(mocks.saveBackend).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      {
        sink: "bigquery",
        table,
        backfillCursor: "evt_last",
        backfillCompleted: true,
      },
    );
  });

  function stageCompletedBackfill() {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: "evt_last",
      backfillCompleted: false,
    });
    mocks.getJob.mockResolvedValueOnce({
      status: "completed",
      cursor: "evt_last",
    });
  }

  function stageUnrunnablePanel() {
    mocks.listDashboards.mockResolvedValue([
      {
        id: "weekly-metrics",
        title: "Weekly metrics",
        config: {
          panels: [
            {
              id: "monthly",
              title: "Monthly signups",
              source: "first-party",
              sql: "SELECT date_trunc('month', event_date) FROM analytics_events",
            },
            {
              id: "warehouse",
              title: "Warehouse panel",
              source: "bigquery",
              sql: "SELECT date_trunc('month', d) FROM t",
            },
          ],
        },
      },
    ]);
    mocks.assertBigQuerySql.mockImplementation((sql: string) => {
      if (sql.includes("date_trunc('month'")) {
        throw new FakeUnsupportedSqlError("date_trunc('month', ...)");
      }
    });
  }

  it("refuses to flip the sink while saved panels cannot run on BigQuery", async () => {
    stageCompletedBackfill();
    stageUnrunnablePanel();

    await expect(
      migrateAction.run({ mode: "cutover", confirm: true }),
    ).rejects.toThrow(
      /weekly-metrics\/monthly "Monthly signups" uses date_trunc\('month', \.\.\.\)/,
    );

    expect(mocks.saveBackend).not.toHaveBeenCalled();
    // Only first-party panels route through the translator; a warehouse panel
    // already speaks BigQuery.
    expect(mocks.assertBigQuerySql).toHaveBeenCalledTimes(1);
  });

  it("cuts over with the affected panels reported once they are acknowledged", async () => {
    stageCompletedBackfill();
    stageUnrunnablePanel();

    await expect(
      migrateAction.run({
        mode: "cutover",
        confirm: true,
        acknowledgeUnrunnablePanels: true,
      }),
    ).resolves.toMatchObject({
      sink: "bigquery",
      unrunnablePanels: [
        {
          dashboardId: "weekly-metrics",
          panelId: "monthly",
          reason: "uses date_trunc('month', ...)",
        },
      ],
    });

    expect(mocks.saveBackend).toHaveBeenCalled();
  });

  it("reports the affected panels from status before anyone cuts over", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: "evt_last",
      backfillCompleted: false,
    });
    mocks.getJob.mockResolvedValueOnce({ status: "pending" });
    mocks.assertReady.mockResolvedValueOnce({
      table: { fullyQualified: table },
      rowCount: 10,
    });
    stageUnrunnablePanel();

    await expect(migrateAction.run({ mode: "status" })).resolves.toMatchObject({
      unrunnablePanels: [{ panelId: "monthly" }],
    });
  });
});
