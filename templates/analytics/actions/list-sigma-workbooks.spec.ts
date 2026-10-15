import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  resolveConnection: vi.fn(),
  listWorkbooks: vi.fn(),
  listMigrations: vi.fn(),
  loadDashboardMetadata: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/analytics/adhoc/dashboard",
}));
vi.mock("../server/lib/bi-migration/external-dashboards-store.js", () => ({
  listExternalDashboards: mocks.listMigrations,
}));
vi.mock("../server/lib/bi-migration/sigma-adapter.js", () => ({
  listSigmaWorkbooks: mocks.listWorkbooks,
}));
vi.mock("../server/lib/bi-migration/sigma-connections.js", () => ({
  resolveSigmaConnectionSelection: mocks.resolveConnection,
}));
vi.mock("../server/lib/bi-migration/sigma-migration.js", () => ({
  requireSigmaMigrationContext: mocks.requireContext,
  sigmaMigrationSetupLink: () => "/dispatch",
}));
vi.mock("../server/lib/dashboards-store.js", () => ({
  loadAccessibleDashboardMetadataByIds: mocks.loadDashboardMetadata,
}));

const { default: listSigmaWorkbooks } =
  await import("./list-sigma-workbooks.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue({
    email: "alice@example.com",
    userEmail: "alice@example.com",
    orgId: "org-1",
  });
  mocks.resolveConnection.mockResolvedValue({
    selected: { id: "connection_1", label: "Sigma", status: "connected" },
    connections: [{ id: "connection_1", label: "Sigma", status: "connected" }],
    requiresSelection: false,
  });
  mocks.listWorkbooks.mockResolvedValue({
    workbooks: [{ workbookId: "workbook_1", name: "Revenue" }],
    nextPage: null,
  });
  mocks.listMigrations.mockResolvedValue([]);
  mocks.loadDashboardMetadata.mockResolvedValue([]);
});

describe("list-sigma-workbooks", () => {
  it("marks a missing imported dashboard recoverable for its original migrator", async () => {
    mocks.listMigrations.mockResolvedValue([
      {
        status: "migrated",
        sourceId: "workbook_1",
        targetDashboardId: "dashboard_1",
        migratedByCurrentUser: true,
        flaggedCount: 0,
      },
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      id: "workbook_1",
      status: "migrated",
      canRecoverMissingDashboard: true,
    });
    expect(result.workbooks[0]).not.toHaveProperty("dashboardUrl");
    expect(mocks.loadDashboardMetadata).toHaveBeenCalledWith(
      { email: "alice@example.com", orgId: "org-1" },
      ["dashboard_1"],
    );
  });

  it("keeps an owned shared import linked instead of marking it recoverable", async () => {
    mocks.listMigrations.mockResolvedValue([
      {
        status: "migrated",
        sourceId: "workbook_1",
        targetDashboardId: "dashboard_1",
        migratedByCurrentUser: true,
        flaggedCount: 0,
      },
    ]);
    mocks.loadDashboardMetadata.mockResolvedValue([
      {
        id: "dashboard_1",
        kind: "sql",
        title: "Sigma: Revenue",
        visibility: "org",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
      },
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      dashboardId: "dashboard_1",
      dashboardName: "Sigma: Revenue",
      dashboardUrl: "/analytics/adhoc/dashboard",
    });
    expect(result.workbooks[0]).not.toHaveProperty(
      "canRecoverMissingDashboard",
    );
  });

  it("marks archived Sigma workbooks in the preview result", async () => {
    mocks.listWorkbooks.mockResolvedValue({
      workbooks: [
        {
          workbookId: "workbook_archived",
          name: "Archived Revenue",
          isArchived: true,
        },
      ],
      nextPage: null,
    });

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks).toMatchObject([
      { id: "workbook_archived", name: "Archived Revenue", isArchived: true },
    ]);
  });
});
