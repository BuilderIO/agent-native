import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getBackend: vi.fn(),
  saveBackend: vi.fn(),
  assertReady: vi.fn(),
  backfill: vi.fn(),
  requireAnalyticsAdminContext: vi.fn(),
}));

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
  backfillFirstPartyAnalyticsBatch: mocks.backfill,
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
  mocks.backfill.mockReset();
  mocks.requireAnalyticsAdminContext.mockReset();
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

  it("prepares the current organization for dual-write", async () => {
    await expect(
      migrateAction.run({ mode: "prepare", table }),
    ).resolves.toMatchObject({ sink: "dual", table });

    expect(mocks.assertReady).toHaveBeenCalledWith(table);
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

  it("advances the bounded backfill cursor", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: "evt_previous",
      backfillCompleted: false,
    });
    mocks.backfill.mockResolvedValueOnce({
      nextCursor: "evt_next",
      copied: 100,
      complete: false,
    });

    await expect(
      migrateAction.run({ mode: "backfill", limit: 100 }),
    ).resolves.toMatchObject({ nextCursor: "evt_next", next: "backfill" });

    expect(mocks.backfill).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      "evt_previous",
      100,
      table,
    );
    expect(mocks.saveBackend).toHaveBeenCalledWith(
      { userEmail: "owner@builder.io", orgId: "org_builder" },
      {
        sink: "dual",
        table,
        backfillCursor: "evt_next",
        backfillCompleted: false,
      },
    );
  });

  it("refuses cutover until the backfill is complete and confirmed", async () => {
    mocks.getBackend.mockResolvedValueOnce({
      sink: "dual",
      table,
      backfillCursor: "evt_next",
      backfillCompleted: false,
    });

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
      backfillCompleted: true,
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
});
