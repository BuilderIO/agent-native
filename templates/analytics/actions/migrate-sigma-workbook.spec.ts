import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  resolveConnection: vi.fn(),
  hasBigQuery: vi.fn(),
  inspectWorkbook: vi.fn(),
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
    sourceConnections: [],
    sqlQueries: [],
    diagnostics: [],
  });
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
  async function expectNoImportableMigration(elements: unknown[]) {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId, name: "Revenue" },
      elements,
      sourceConnections: [],
      sqlQueries: [],
      diagnostics: [],
    });
    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({ errorCode: "sigma_no_importable_elements" });

    expect(mocks.createMigration).not.toHaveBeenCalled();
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  }

  it("rejects an empty workbook before creating a migration", async () => {
    await expectNoImportableMigration([]);
  });

  it("rejects a workbook with only unsupported elements", async () => {
    await expectNoImportableMigration([
      {
        kind: "unsupported",
        id: "element_1",
        title: "Unsupported",
        sigmaKind: "unsupported_visualization",
      },
    ]);
  });

  it("rejects an unmapped workbook before loading its SQL pages", async () => {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId, name: "Revenue" },
      elements: [panel],
      sourceConnections: [
        {
          connectionId: "connection_1",
          sigmaType: "bigquery",
          targetProviderCandidate: "bigquery",
        },
      ],
      sqlQueries: [],
      diagnostics: [],
    });

    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({ errorCode: "sigma_source_mapping_required" });

    expect(mocks.inspectWorkbook).toHaveBeenCalledTimes(1);
    expect(mocks.inspectWorkbook).toHaveBeenCalledWith({
      connectionId: "connection_1",
      workbookId,
      includeSqlQueries: false,
    });
    expect(mocks.createMigration).not.toHaveBeenCalled();
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  });

  it("keeps source lookup failures retryable before loading SQL", async () => {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId, name: "Revenue" },
      elements: [panel],
      sourceConnections: [],
      sqlQueries: [],
      diagnostics: [
        {
          code: "sigma_source_connection_lookup_failed",
          severity: "error",
          message: "Connection metadata could not be verified.",
          connectionId: "source_1",
        },
      ],
    });

    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({
      errorCode: "sigma_source_inspection_failed",
      statusCode: 503,
    });

    expect(mocks.inspectWorkbook).toHaveBeenCalledTimes(1);
    expect(mocks.inspectWorkbook).toHaveBeenCalledWith({
      connectionId: "connection_1",
      workbookId,
      includeSqlQueries: false,
    });
    expect(mocks.createMigration).not.toHaveBeenCalled();
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  });

  it("uses a stable source suffix to distinguish same-named workbooks", () => {
    const first = sigmaDashboardName("Revenue", "workbook_1");
    const second = sigmaDashboardName("Revenue", "workbook_2");

    expect(first).toBe(sigmaDashboardName("Revenue", "workbook_1"));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^Sigma: Revenue · [a-f0-9]{20}$/);
  });
});
