import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  linkExternalDashboard: vi.fn(),
  resolveConnection: vi.fn(),
  getWorkbook: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/analytics/adhoc/dashboard",
}));
vi.mock("../server/lib/bi-migration/sigma-migration.js", () => ({
  requireSigmaMigrationContext: mocks.requireContext,
}));
vi.mock("../server/lib/bi-migration/external-dashboards-store.js", () => ({
  linkExternalDashboard: mocks.linkExternalDashboard,
}));
vi.mock("../server/lib/bi-migration/sigma-connections.js", () => ({
  resolveSigmaConnectionSelection: mocks.resolveConnection,
}));
vi.mock("../server/lib/bi-migration/sigma-adapter.js", () => ({
  getSigmaWorkbookSummary: mocks.getWorkbook,
}));
vi.mock("../server/lib/dashboards-store.js", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboardWithRetry: mocks.upsertDashboard,
}));

const { default: linkSigmaDashboard } =
  await import("./link-sigma-dashboard.js");

const ownedDashboard = {
  id: "arr-changes",
  kind: "sql",
  title: "ARR Changes",
  ownerEmail: "Alice@example.com",
  orgId: "org-1",
  config: { name: "ARR Changes", panels: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue({
    email: "alice@example.com",
    userEmail: "alice@example.com",
    orgId: "org-1",
  });
  mocks.getDashboard.mockResolvedValue(ownedDashboard);
  mocks.resolveConnection.mockResolvedValue({
    selected: { id: "connection_1", label: "Sigma", status: "connected" },
    connections: [],
    requiresSelection: false,
  });
  mocks.getWorkbook.mockResolvedValue({
    workbookId: "workbook_1",
    name: "ARR Changes - FY 2027 New",
  });
  mocks.linkExternalDashboard.mockResolvedValue({
    migratedAt: "2026-10-19T12:00:00.000Z",
  });
  mocks.upsertDashboard.mockImplementation(async (_id, _ctx, mutate) =>
    mutate(ownedDashboard),
  );
});

describe("link-sigma-dashboard", () => {
  it("records the mapping and stamps the dashboard's origin", async () => {
    const result: any = await linkSigmaDashboard.run({
      workbookId: "workbook_1",
      dashboardId: "arr-changes",
    });

    expect(mocks.getWorkbook).toHaveBeenCalledWith({
      connectionId: "connection_1",
      workbookId: "workbook_1",
    });
    expect(mocks.linkExternalDashboard).toHaveBeenCalledWith({
      provider: "sigma",
      sourceId: "workbook_1",
      sourceName: "ARR Changes - FY 2027 New",
      targetDashboardId: "arr-changes",
    });
    const mutate = mocks.upsertDashboard.mock.calls[0]?.[2];
    expect(mutate(ownedDashboard)).toEqual({
      kind: "sql",
      body: {
        name: "ARR Changes",
        panels: [],
        origin: {
          provider: "sigma",
          sourceId: "workbook_1",
          sourceName: "ARR Changes - FY 2027 New",
          linkedAt: "2026-10-19T12:00:00.000Z",
        },
      },
    });
    expect(result).toMatchObject({
      status: "linked",
      dashboardId: "arr-changes",
      dashboardUrl: "/analytics/adhoc/dashboard",
    });
  });

  it("refuses a dashboard the caller does not own", async () => {
    mocks.getDashboard.mockResolvedValue({
      ...ownedDashboard,
      ownerEmail: "bob@example.com",
    });

    await expect(
      linkSigmaDashboard.run({
        workbookId: "workbook_1",
        dashboardId: "arr-changes",
      }),
    ).rejects.toMatchObject({
      errorCode: "dashboard_owner_required",
      statusCode: 403,
    });
    expect(mocks.linkExternalDashboard).not.toHaveBeenCalled();
  });

  it("refuses a missing or non-SQL dashboard", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    await expect(
      linkSigmaDashboard.run({
        workbookId: "workbook_1",
        dashboardId: "missing",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    mocks.getDashboard.mockResolvedValue({
      ...ownedDashboard,
      kind: "explorer",
    });
    await expect(
      linkSigmaDashboard.run({
        workbookId: "workbook_1",
        dashboardId: "arr-changes",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not stamp the dashboard when the workbook is already linked", async () => {
    mocks.linkExternalDashboard.mockRejectedValue(
      Object.assign(new Error("already linked"), { statusCode: 409 }),
    );

    await expect(
      linkSigmaDashboard.run({
        workbookId: "workbook_1",
        dashboardId: "arr-changes",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("requires a Sigma connection that can read the workbook", async () => {
    mocks.resolveConnection.mockResolvedValue({
      selected: null,
      connections: [],
      requiresSelection: false,
    });

    await expect(
      linkSigmaDashboard.run({
        workbookId: "workbook_1",
        dashboardId: "arr-changes",
      }),
    ).rejects.toMatchObject({ errorCode: "sigma_connection_required" });
    expect(mocks.linkExternalDashboard).not.toHaveBeenCalled();
  });
});
