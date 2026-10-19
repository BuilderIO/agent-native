import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  resolveConnection: vi.fn(),
  listWorkbooks: vi.fn(),
  listMigrations: vi.fn(),
  loadDashboardMetadata: vi.fn(),
  loadDashboardOwners: vi.fn(),
  getUserProfiles: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/analytics/adhoc/dashboard",
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: mocks.getUserProfiles,
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
  loadOrgDashboardOwnersByIds: mocks.loadDashboardOwners,
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
  mocks.loadDashboardOwners.mockResolvedValue([]);
  mocks.getUserProfiles.mockResolvedValue(new Map());
});

function migratedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "migrated",
    sourceId: "workbook_1",
    targetDashboardId: "dashboard_1",
    migratedByCurrentUser: false,
    migratedByEmail: "bob@example.com",
    flaggedCount: 0,
    ...overrides,
  };
}

const bobsDashboardOwner = {
  id: "dashboard_1",
  kind: "sql",
  ownerEmail: "Bob@example.com",
};

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
    mocks.loadDashboardOwners.mockResolvedValue([
      { id: "dashboard_1", kind: "sql", ownerEmail: "alice@example.com" },
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      dashboardId: "dashboard_1",
      dashboardName: "Sigma: Revenue",
      dashboardUrl: "/analytics/adhoc/dashboard",
      canOpen: true,
    });
    expect(result.workbooks[0]).not.toHaveProperty(
      "canRecoverMissingDashboard",
    );
  });

  it("reads mappings only for workbooks the user's Sigma account returned", async () => {
    mocks.listWorkbooks.mockResolvedValue({
      workbooks: [
        { workbookId: "workbook_1", name: "Revenue" },
        { workbookId: "workbook_2", name: "Pipeline" },
      ],
      nextPage: null,
    });
    // Even if the store returned an unrelated row, it must not surface.
    mocks.listMigrations.mockResolvedValue([
      migratedRow({ sourceId: "workbook_hidden" }),
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(mocks.listMigrations).toHaveBeenCalledWith({
      provider: "sigma",
      sourceIds: ["workbook_1", "workbook_2"],
      limit: 100,
    });
    expect(mocks.listWorkbooks).toHaveBeenCalledWith({
      connectionId: "connection_1",
      page: undefined,
      limit: 1_000,
    });
    expect(result.workbooks.map((workbook: any) => workbook.id)).toEqual([
      "workbook_1",
      "workbook_2",
    ]);
    expect(
      result.workbooks.every(
        (workbook: any) => workbook.status === "not_started",
      ),
    ).toBe(true);
  });

  it("shows a teammate's private import with its owner but no title", async () => {
    mocks.listMigrations.mockResolvedValue([migratedRow()]);
    mocks.loadDashboardOwners.mockResolvedValue([bobsDashboardOwner]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      status: "migrated",
      dashboardId: "dashboard_1",
      dashboardUrl: "/analytics/adhoc/dashboard",
      canOpen: false,
      migratedOwnerEmail: "bob@example.com",
      migratedByTeammate: true,
    });
    expect(result.workbooks[0]).not.toHaveProperty("dashboardName");
    expect(result.workbooks[0]).not.toHaveProperty(
      "canRecoverMissingDashboard",
    );
    expect(mocks.loadDashboardOwners).toHaveBeenCalledWith("org-1", [
      "dashboard_1",
    ]);
  });

  it("lets a teammate open an import shared with them", async () => {
    mocks.listMigrations.mockResolvedValue([migratedRow()]);
    mocks.loadDashboardOwners.mockResolvedValue([bobsDashboardOwner]);
    mocks.loadDashboardMetadata.mockResolvedValue([
      {
        id: "dashboard_1",
        kind: "sql",
        title: "ARR Changes",
        visibility: "org",
        ownerEmail: "bob@example.com",
        orgId: "org-1",
      },
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      dashboardId: "dashboard_1",
      dashboardName: "ARR Changes",
      canOpen: true,
      migratedOwnerEmail: "bob@example.com",
    });
  });

  it("names the migrator when the imported dashboard no longer exists", async () => {
    mocks.listMigrations.mockResolvedValue([migratedRow()]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      status: "migrated",
      migratedOwnerEmail: "bob@example.com",
    });
    expect(result.workbooks[0]).not.toHaveProperty("dashboardId");
    expect(result.workbooks[0]).not.toHaveProperty(
      "canRecoverMissingDashboard",
    );
  });

  it("marks a workbook a teammate is importing right now", async () => {
    mocks.listMigrations.mockResolvedValue([
      migratedRow({ status: "migrating", targetDashboardId: null }),
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      status: "migrating",
      migratingByEmail: "bob@example.com",
    });
    expect(result.workbooks[0]).not.toHaveProperty("dashboardId");
  });

  it("marks the caller's own import as in progress, with their name", async () => {
    mocks.listMigrations.mockResolvedValue([
      migratedRow({
        status: "migrating",
        targetDashboardId: null,
        migratedByCurrentUser: true,
        migratedByEmail: "alice@example.com",
      }),
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({
      status: "migrating",
      migratingByEmail: "alice@example.com",
    });
    expect(result.workbooks[0]).not.toHaveProperty("canRetryStaleClaim");
  });

  it("passes on whether the caller may start an import", async () => {
    mocks.listWorkbooks.mockResolvedValue({
      workbooks: [
        { workbookId: "workbook_1", name: "Revenue" },
        { workbookId: "workbook_2", name: "Pipeline" },
      ],
      nextPage: null,
    });
    mocks.listMigrations.mockResolvedValue([
      migratedRow({
        status: "failed",
        targetDashboardId: null,
        canStartImport: false,
      }),
    ]);

    const result: any = await listSigmaWorkbooks.run({});

    expect(result.workbooks[0]).toMatchObject({ canStartImport: false });
    // A workbook nobody has tried to import has no mapping row yet.
    expect(result.workbooks[1]).toMatchObject({ canStartImport: true });
  });

  it("names owners and migrators from one profile lookup", async () => {
    mocks.listWorkbooks.mockResolvedValue({
      workbooks: [
        { workbookId: "workbook_1", name: "Revenue" },
        { workbookId: "workbook_2", name: "Pipeline" },
        { workbookId: "workbook_3", name: "Churn" },
      ],
      nextPage: null,
    });
    mocks.listMigrations.mockResolvedValue([
      migratedRow(),
      migratedRow({
        sourceId: "workbook_2",
        status: "migrating",
        targetDashboardId: null,
        migratedByEmail: "carol.jones@example.com",
      }),
    ]);
    mocks.loadDashboardOwners.mockResolvedValue([bobsDashboardOwner]);
    mocks.getUserProfiles.mockResolvedValue(
      new Map([
        ["bob@example.com", { email: "bob@example.com", name: "Bob Smith" }],
        [
          "carol.jones@example.com",
          { email: "carol.jones@example.com", name: "Carol Jones" },
        ],
      ]),
    );

    const result: any = await listSigmaWorkbooks.run({});

    expect(mocks.getUserProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.getUserProfiles).toHaveBeenCalledWith([
      "bob@example.com",
      "carol.jones@example.com",
    ]);
    expect(result.workbooks[0]).toMatchObject({
      migratedOwnerEmail: "bob@example.com",
      migratedOwnerName: "Bob Smith",
    });
    // A name built from the email adds nothing, so the tooltip shows the email.
    expect(result.workbooks[1]).toMatchObject({
      migratingByEmail: "carol.jones@example.com",
      migratingByName: null,
    });
    expect(result.workbooks[2]).not.toHaveProperty("migratedOwnerEmail");
  });

  it("reads mappings for a full page of workbooks in chunks of 100", async () => {
    mocks.listWorkbooks.mockResolvedValue({
      workbooks: Array.from({ length: 250 }, (_, index) => ({
        workbookId: `workbook_${index}`,
        name: `Workbook ${index}`,
      })),
      nextPage: null,
    });

    const result: any = await listSigmaWorkbooks.run({});

    expect(
      mocks.listMigrations.mock.calls.map(([input]) => input.sourceIds.length),
    ).toEqual([100, 100, 50]);
    expect(result.workbooks).toHaveLength(250);
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
