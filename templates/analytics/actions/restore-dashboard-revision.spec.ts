import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restoreDashboardRevision: vi.fn(),
  getDashboard: vi.fn(),
  resolvePanel: vi.fn(),
  credentials: vi.fn(),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  assertDashboardEditable: vi.fn(async () => undefined),
  restoreDashboardRevision: mocks.restoreDashboardRevision,
  getDashboard: mocks.getDashboard,
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(),
  getText: vi.fn(async () => ""),
  hasCollabState: vi.fn().mockResolvedValue(false),
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getCredentialContext: mocks.credentials,
  }),
);
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));
vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: vi.fn(async () => null),
  dryRunQuerySchema: vi.fn(async () => ({ error: null })),
}));

const { default: restoreDashboard } =
  await import("./restore-dashboard-revision");

const agent = { caller: "tool" } as never;
const args = { dashboardId: "dashboard-1", revisionId: "revision-1" };

function pivotPanel(sql: string) {
  return {
    id: "by-app",
    title: "By app",
    source: "bigquery",
    chartType: "line",
    width: 2,
    sql,
    config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } },
  };
}

function restored(sql: string) {
  return {
    snapshotRevisionId: "snapshot-1",
    dashboard: {
      id: "dashboard-1",
      kind: "sql",
      title: "Growth",
      updatedAt: "2026-10-01T00:00:00.000Z",
      config: { name: "Growth", panels: [pivotPanel(sql)] },
    },
  };
}

describe("restore-dashboard-revision action", () => {
  beforeEach(() => {
    mocks.restoreDashboardRevision.mockReset();
    mocks.getDashboard.mockReset();
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Growth", panels: [pivotPanel("SELECT week, app, n")] },
    });
    mocks.resolvePanel.mockReset();
    mocks.credentials.mockReset();
    mocks.credentials.mockReturnValue({
      userEmail: "alice@example.com",
      orgId: null,
    });
  });

  it("returns a 404-shaped error when the revision is gone", async () => {
    mocks.restoreDashboardRevision.mockResolvedValue(null);

    await expect(restoreDashboard.run(args)).rejects.toMatchObject({
      statusCode: 404,
      message:
        'Dashboard revision "revision-1" was not found for dashboard "dashboard-1".',
    });
  });

  it("restores for an agent and reports a panel that no longer renders instead of refusing", async () => {
    mocks.restoreDashboardRevision.mockResolvedValue(
      restored("SELECT week, mail, clips"),
    );
    mocks.resolvePanel.mockResolvedValue({
      rows: [{ week: "2026-09-01", mail: 1, clips: 2 }],
      schema: ["week", "mail", "clips"].map((name) => ({
        name,
        type: "STRING",
      })),
    });

    const result: any = await restoreDashboard.run(args, agent);

    expect(result.snapshotRevisionId).toBe("snapshot-1");
    expect(result.verified).toBe(false);
    expect(result.unverified[0]).toMatchObject({
      panelId: "by-app",
      status: "missing-columns",
    });
    expect(result.nextStep).toContain("inspect-dashboard-panel");
    expect(result.message).toMatch(/^SAVED BUT NOT VERIFIED: Restored/);
    expect(result._receipt).toMatchObject({
      changed: true,
      verified: false,
      subject: "dashboard-1",
      summary: expect.stringContaining('Restored "dashboard-1" from history'),
      checks: [{ id: "by-app", ok: false }],
    });
  });

  it("reports a clean restore as verified", async () => {
    mocks.restoreDashboardRevision.mockResolvedValue(
      restored("SELECT week, app, n FROM old"),
    );
    mocks.resolvePanel.mockResolvedValue({
      rows: [{ week: "2026-09-01", app: "mail", n: 1 }],
      schema: ["week", "app", "n"].map((name) => ({ name, type: "STRING" })),
    });

    const result: any = await restoreDashboard.run(args, agent);

    expect(result.verified).toBe(true);
    expect(result.message).toContain("Verified: By app -> 1 rows");
    expect(result._receipt).toMatchObject({
      changed: true,
      verified: true,
      subject: "dashboard-1",
      checks: [{ id: "by-app", ok: true }],
    });
  });

  it("says so when the restore saved but verification could not run", async () => {
    mocks.restoreDashboardRevision.mockResolvedValue(
      restored("SELECT week, app, n FROM old"),
    );
    mocks.credentials.mockReturnValue(null);

    const result: any = await restoreDashboard.run(args, agent);

    expect(result.snapshotRevisionId).toBe("snapshot-1");
    expect(result.verified).toBe(false);
    expect(result.nextStep).toContain("restore was saved");
    expect(result._receipt).toMatchObject({
      changed: true,
      verified: "unverified",
      subject: "dashboard-1",
    });
  });

  it("never runs a panel for a viewer, whose restore the store refuses", async () => {
    mocks.restoreDashboardRevision.mockRejectedValue(
      Object.assign(
        new Error(
          "Requires editor role on dashboard dashboard-1 (have viewer)",
        ),
        { statusCode: 403 },
      ),
    );

    await expect(restoreDashboard.run(args, agent)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });

  it("leaves UI restores unverified and unchanged", async () => {
    mocks.restoreDashboardRevision.mockResolvedValue(
      restored("SELECT week, mail, clips"),
    );

    const result: any = await restoreDashboard.run(args);

    expect(result.verified).toBeUndefined();
    expect(result._receipt).toBeUndefined();
    expect(result.message).toBe('Restored dashboard "Growth" from history.');
    // The collab sync re-reads the saved record; no read may precede the restore.
    const [restoreOrder] =
      mocks.restoreDashboardRevision.mock.invocationCallOrder;
    for (const readOrder of mocks.getDashboard.mock.invocationCallOrder) {
      expect(readOrder).toBeGreaterThan(restoreOrder);
    }
    expect(mocks.resolvePanel).not.toHaveBeenCalled();
  });
});
