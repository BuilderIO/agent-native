import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failMigration: vi.fn(),
  getDashboard: vi.fn(),
  holdClaim: vi.fn(),
  listMigrations: vi.fn(),
  removeDashboard: vi.fn(),
}));

vi.mock("./external-dashboards-store.js", () => ({
  failExternalDashboard: mocks.failMigration,
  holdExternalDashboardClaim: mocks.holdClaim,
  listExternalDashboards: mocks.listMigrations,
}));
vi.mock("../dashboards-store.js", () => ({
  getDashboard: mocks.getDashboard,
  removeDashboard: mocks.removeDashboard,
}));

const { abandonSigmaImport } = await import("./unfinished-import.js");

const ctx = { email: "alice@example.com", orgId: "org-1" };
const base = {
  workbookId: "workbook_1",
  claimToken: "token_1",
  failureCode: "verification_failed" as const,
  dashboardId: "sigma-alice-workbook_1",
  ctx,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.holdClaim.mockResolvedValue(true);
  mocks.failMigration.mockResolvedValue({});
  mocks.listMigrations.mockResolvedValue([]);
  mocks.removeDashboard.mockResolvedValue(undefined);
  mocks.getDashboard.mockResolvedValue({
    visibility: "private",
    ownerEmail: "Alice@example.com",
    orgId: "org-1",
  });
});

describe("abandonSigmaImport", () => {
  it("deletes a first import's dashboard before releasing the claim", async () => {
    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: null,
    });

    expect(mocks.holdClaim).toHaveBeenCalledWith({
      provider: "sigma",
      sourceId: "workbook_1",
      claimToken: "token_1",
    });
    expect(mocks.removeDashboard).toHaveBeenCalledWith(
      "sigma-alice-workbook_1",
      ctx,
    );
    expect(mocks.failMigration).toHaveBeenCalledWith({
      provider: "sigma",
      sourceId: "workbook_1",
      claimToken: "token_1",
      failureCode: "verification_failed",
      preservePreviousMigration: false,
    });
    // A same-user retry can only claim after the release, so the dashboard it
    // writes at the same id is never the one deleted here.
    const [hold] = mocks.holdClaim.mock.invocationCallOrder;
    const [remove] = mocks.removeDashboard.mock.invocationCallOrder;
    const [release] = mocks.failMigration.mock.invocationCallOrder;
    expect(hold).toBeLessThan(remove);
    expect(remove).toBeLessThan(release);
  });

  it("deletes an earlier run's dashboard when this first import wrote nothing", async () => {
    // A same-user takeover of a stuck first import shares its dashboard id.
    await abandonSigmaImport({
      ...base,
      wroteDashboard: false,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).toHaveBeenCalledWith(
      "sigma-alice-workbook_1",
      ctx,
    );
    expect(mocks.failMigration).toHaveBeenCalledWith(
      expect.objectContaining({ preservePreviousMigration: true }),
    );
  });

  it("keeps an earlier run's dashboard once it has been shared", async () => {
    // The id-conflict check refuses to overwrite it, so cleanup must not
    // delete what that check protected.
    mocks.getDashboard.mockResolvedValue({
      visibility: "org",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    await abandonSigmaImport({
      ...base,
      wroteDashboard: false,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).not.toHaveBeenCalled();
    expect(mocks.failMigration).toHaveBeenCalled();
  });

  it("still releases the claim when the leftover check fails", async () => {
    mocks.getDashboard.mockRejectedValue(new Error("read failed"));

    await abandonSigmaImport({
      ...base,
      wroteDashboard: false,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).not.toHaveBeenCalled();
    expect(mocks.failMigration).toHaveBeenCalled();
  });

  it("never deletes the dashboard a re-import or its retry wrote over", async () => {
    // A plain retry of a failed re-import claims a record that still has its
    // dashboard, so the request's flags alone would call it a first import.
    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: "sigma-alice-workbook_1",
    });

    expect(mocks.removeDashboard).not.toHaveBeenCalled();
    expect(mocks.failMigration).toHaveBeenCalled();
  });

  it("still releases the claim when the delete fails", async () => {
    mocks.removeDashboard.mockRejectedValue(new Error("delete failed"));

    await expect(
      abandonSigmaImport({
        ...base,
        wroteDashboard: true,
        previousDashboardId: null,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.failMigration).toHaveBeenCalled();
  });

  it("does not throw when recording the failure fails", async () => {
    // The caller rethrows the import's own error; this one is only logged.
    mocks.failMigration.mockRejectedValue(new Error("database unavailable"));

    await expect(
      abandonSigmaImport({
        ...base,
        wroteDashboard: true,
        previousDashboardId: null,
      }),
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("deletes its dashboard when a teammate took over the claim", async () => {
    mocks.holdClaim.mockResolvedValue(false);
    mocks.listMigrations.mockResolvedValue([
      { status: "migrating", migratedByCurrentUser: false },
    ]);

    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).toHaveBeenCalledWith(
      "sigma-alice-workbook_1",
      ctx,
    );
    expect(mocks.failMigration).not.toHaveBeenCalled();
  });

  it("keeps a dashboard this run wrote once it has been shared", async () => {
    mocks.getDashboard.mockResolvedValue({
      visibility: "org",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).not.toHaveBeenCalled();
    expect(mocks.failMigration).toHaveBeenCalled();
  });

  it("keeps a shared dashboard after a teammate took over the claim", async () => {
    mocks.holdClaim.mockResolvedValue(false);
    mocks.listMigrations.mockResolvedValue([
      { status: "migrating", migratedByCurrentUser: false },
    ]);
    mocks.getDashboard.mockResolvedValue({
      visibility: "org",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).not.toHaveBeenCalled();
  });

  it("keeps the dashboard when the same person took over the claim", async () => {
    // Their new run writes the same dashboard id.
    mocks.holdClaim.mockResolvedValue(false);
    mocks.listMigrations.mockResolvedValue([
      { status: "migrating", migratedByCurrentUser: true },
    ]);

    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: null,
    });

    expect(mocks.removeDashboard).not.toHaveBeenCalled();
    expect(mocks.failMigration).not.toHaveBeenCalled();
  });

  it("leaves the dashboard alone after losing a claim it never wrote under", async () => {
    mocks.holdClaim.mockResolvedValue(false);

    await abandonSigmaImport({
      ...base,
      wroteDashboard: false,
      previousDashboardId: null,
    });

    expect(mocks.listMigrations).not.toHaveBeenCalled();
    expect(mocks.removeDashboard).not.toHaveBeenCalled();
  });
});
