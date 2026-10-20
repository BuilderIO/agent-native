import { fail } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failMigration: vi.fn(),
  listMigrations: vi.fn(),
  removeDashboard: vi.fn(),
}));

vi.mock("./external-dashboards-store.js", () => ({
  failExternalDashboard: mocks.failMigration,
  listExternalDashboards: mocks.listMigrations,
}));
vi.mock("../dashboards-store.js", () => ({
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

function claimExpired(): Error {
  try {
    fail("The migration claim is no longer active.", {
      errorCode: "migration_claim_expired",
      statusCode: 409,
    });
  } catch (error) {
    return error as Error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failMigration.mockResolvedValue({});
  mocks.listMigrations.mockResolvedValue([]);
  mocks.removeDashboard.mockResolvedValue(undefined);
});

describe("abandonSigmaImport", () => {
  it("deletes a first import's dashboard after recording the failure", async () => {
    await abandonSigmaImport({
      ...base,
      wroteDashboard: true,
      previousDashboardId: null,
    });

    expect(mocks.failMigration).toHaveBeenCalledWith({
      provider: "sigma",
      sourceId: "workbook_1",
      claimToken: "token_1",
      failureCode: "verification_failed",
      preservePreviousMigration: false,
    });
    expect(mocks.removeDashboard).toHaveBeenCalledWith(
      "sigma-alice-workbook_1",
      ctx,
    );
  });

  it("keeps the previous migration when nothing was written", async () => {
    await abandonSigmaImport({
      ...base,
      wroteDashboard: false,
      previousDashboardId: null,
    });

    expect(mocks.failMigration).toHaveBeenCalledWith(
      expect.objectContaining({ preservePreviousMigration: true }),
    );
    expect(mocks.removeDashboard).not.toHaveBeenCalled();
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
  });

  it("deletes its dashboard when a teammate took over the claim", async () => {
    const expired = claimExpired();
    mocks.failMigration.mockRejectedValue(expired);
    mocks.listMigrations.mockResolvedValue([
      { status: "migrating", migratedByCurrentUser: false },
    ]);

    await expect(
      abandonSigmaImport({
        ...base,
        wroteDashboard: true,
        previousDashboardId: null,
      }),
    ).rejects.toBe(expired);
    expect(mocks.removeDashboard).toHaveBeenCalledWith(
      "sigma-alice-workbook_1",
      ctx,
    );
  });

  it("keeps the dashboard when the same person took over the claim", async () => {
    // Their new run writes the same dashboard id.
    const expired = claimExpired();
    mocks.failMigration.mockRejectedValue(expired);
    mocks.listMigrations.mockResolvedValue([
      { status: "migrating", migratedByCurrentUser: true },
    ]);

    await expect(
      abandonSigmaImport({
        ...base,
        wroteDashboard: true,
        previousDashboardId: null,
      }),
    ).rejects.toBe(expired);
    expect(mocks.removeDashboard).not.toHaveBeenCalled();
  });

  it("passes on any other failure without deleting", async () => {
    const outage = new Error("database unavailable");
    mocks.failMigration.mockRejectedValue(outage);

    await expect(
      abandonSigmaImport({
        ...base,
        wroteDashboard: true,
        previousDashboardId: null,
      }),
    ).rejects.toBe(outage);
    expect(mocks.removeDashboard).not.toHaveBeenCalled();
  });
});
