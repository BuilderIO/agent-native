import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  resolveConnection: vi.fn(),
  hasBigQuery: vi.fn(),
  inspectWorkbook: vi.fn(),
  summarizeReview: vi.fn(),
  createMigration: vi.fn(),
  claimMigration: vi.fn(),
  listMigrations: vi.fn(),
  completeMigration: vi.fn(),
  failMigration: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  assignToFolder: vi.fn(),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/analytics/adhoc/dashboard",
}));
vi.mock("../server/lib/bi-migration/sigma-adapter.js", () => ({
  inspectSigmaWorkbook: mocks.inspectWorkbook,
}));
vi.mock("../server/lib/bi-migration/sigma-connections.js", () => ({
  resolveSigmaConnectionSelection: mocks.resolveConnection,
}));
vi.mock("../server/lib/bi-migration/sigma-migration.js", () => ({
  hasAnalyticsBigQuerySource: mocks.hasBigQuery,
  requireSigmaMigrationContext: mocks.requireContext,
  sigmaMigrationSetupLink: () => "/dispatch",
}));
vi.mock("../server/lib/bi-migration/external-dashboards-store.js", () => ({
  boundExternalDashboardDiagnostics: (diagnostics: unknown[]) => ({
    elementDiagnostics: diagnostics,
    flaggedCount: diagnostics.length,
  }),
  claimExternalDashboard: mocks.claimMigration,
  completeExternalDashboard: mocks.completeMigration,
  createExternalDashboard: mocks.createMigration,
  failExternalDashboard: mocks.failMigration,
  listExternalDashboards: mocks.listMigrations,
}));
vi.mock("../server/lib/dashboard-folders-store.js", () => ({
  assignDashboardToFolder: mocks.assignToFolder,
  createDashboardFolder: mocks.createFolder,
  listDashboardFolders: mocks.listFolders,
}));
vi.mock("../server/lib/dashboards-store.js", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));
vi.mock("../server/lib/read-only-sql.js", () => ({
  assertReadOnlySql: vi.fn(),
}));
vi.mock("./inspect-sigma-workbook.js", () => ({
  summarizeSigmaElementReview: mocks.summarizeReview,
}));

const { default: migrateSigmaWorkbook, sigmaDashboardName } =
  await import("./migrate-sigma-workbook.js");

const context = {
  email: "alice@example.com",
  userEmail: "alice@example.com",
  orgId: "org-1",
};
const workbookId = "workbook_1";
const panel = {
  kind: "panel",
  id: "element_1",
  title: "Revenue",
  chartType: "table",
  source: { connectionId: "connection_1" },
  columns: [],
};
const expectedDashboardId = `sigma-${createHash("sha256")
  .update(`${context.orgId}\n${context.userEmail}\n${workbookId}`)
  .digest("hex")
  .slice(0, 36)}`;

function configureImportableWorkbook() {
  mocks.inspectWorkbook.mockResolvedValue({
    workbook: { workbookId, name: "Revenue" },
    elements: [panel],
    sqlQueries: [{ elementId: "element_1", sql: "SELECT 1" }],
  });
  mocks.summarizeReview.mockReturnValue([
    { id: "element_1", importable: true },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue(context);
  mocks.resolveConnection.mockResolvedValue({
    selected: { id: "connection_1", label: "Sigma", status: "connected" },
    connections: [],
  });
  mocks.hasBigQuery.mockResolvedValue(true);
  mocks.inspectWorkbook.mockResolvedValue({
    workbook: { workbookId, name: "Revenue" },
    elements: [],
    sqlQueries: [],
  });
  mocks.summarizeReview.mockReturnValue([]);
  mocks.createMigration.mockResolvedValue({});
  mocks.claimMigration.mockResolvedValue({
    claimed: false,
    reason: "in_progress",
  });
  mocks.listMigrations.mockResolvedValue([]);
  mocks.listFolders.mockResolvedValue([]);
  mocks.createFolder.mockResolvedValue({ id: "sigma-folder" });
  mocks.assignToFolder.mockResolvedValue(undefined);
  mocks.getDashboard.mockResolvedValue(null);
  mocks.upsertDashboard.mockResolvedValue(undefined);
  mocks.completeMigration.mockResolvedValue({});
  mocks.failMigration.mockResolvedValue({});
});

describe("migrate-sigma-workbook", () => {
  async function expectNoImportableMigration(
    review: unknown[],
    elements: unknown[],
  ) {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId, name: "Revenue" },
      elements,
      sqlQueries: [],
    });
    mocks.summarizeReview.mockReturnValue(review);
    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({ errorCode: "sigma_no_importable_elements" });

    expect(mocks.createMigration).not.toHaveBeenCalled();
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  }

  it("rejects an empty workbook before creating a migration", async () => {
    await expectNoImportableMigration([], []);
  });

  it("rejects a workbook with only unsupported elements", async () => {
    await expectNoImportableMigration(
      [{ id: "element_1", importable: false, reason: "unsupported_element" }],
      [{ kind: "unsupported", id: "element_1" }],
    );
  });

  it("uses a stable source suffix to distinguish same-named workbooks", () => {
    const first = sigmaDashboardName("Revenue", "workbook_1");
    const second = sigmaDashboardName("Revenue", "workbook_2");

    expect(first).toBe(sigmaDashboardName("Revenue", "workbook_1"));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^Sigma: Revenue · [a-f0-9]{20}$/);
  });

  it("does not recover a dashboard that is still available", async () => {
    configureImportableWorkbook();
    mocks.listMigrations.mockResolvedValue([
      {
        status: "migrated",
        migratedByCurrentUser: true,
        targetDashboardId: expectedDashboardId,
      },
    ]);
    mocks.getDashboard.mockResolvedValue({
      id: expectedDashboardId,
      kind: "sql",
    });

    await expect(
      migrateSigmaWorkbook.run({
        workbookId,
        connectionId: "connection_1",
        recoverMissingDashboard: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "sigma_dashboard_recovery_unavailable",
    });

    expect(mocks.claimMigration).not.toHaveBeenCalled();
  });

  it("reclaims and recreates a missing imported dashboard", async () => {
    configureImportableWorkbook();
    mocks.listMigrations.mockResolvedValue([
      {
        status: "migrated",
        migratedByCurrentUser: true,
        targetDashboardId: expectedDashboardId,
      },
    ]);
    const dashboardName = sigmaDashboardName("Revenue", workbookId);
    mocks.getDashboard
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: expectedDashboardId,
        kind: "sql",
        title: dashboardName,
        visibility: "private",
        ownerEmail: context.userEmail,
        orgId: context.orgId,
        config: { name: dashboardName },
      });
    mocks.claimMigration.mockResolvedValue({
      claimed: true,
      claimToken: "00000000-0000-4000-8000-000000000001",
    });

    const result: any = await migrateSigmaWorkbook.run({
      workbookId,
      connectionId: "connection_1",
      recoverMissingDashboard: true,
    });

    expect(result).toMatchObject({
      status: "completed",
      dashboardId: expectedDashboardId,
    });
    expect(mocks.claimMigration).toHaveBeenCalledWith({
      provider: "sigma",
      sourceId: workbookId,
      remigrate: true,
    });
    expect(mocks.upsertDashboard).toHaveBeenCalledWith(
      expectedDashboardId,
      "sql",
      expect.objectContaining({ name: dashboardName }),
      { email: context.email, orgId: context.orgId },
    );
  });
});
