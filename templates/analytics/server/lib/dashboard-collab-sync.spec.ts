import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyText: vi.fn(async () => undefined),
  hasCollabState: vi.fn(async () => false),
  seedFromText: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/collab", () => mocks);

const { DASHBOARD_COLLAB_SYNC_TIMEOUT_MS, queueDashboardCollabSync } =
  await import("./dashboard-collab-sync");

describe("dashboard collab sync", () => {
  beforeEach(() => {
    mocks.applyText.mockClear();
    mocks.hasCollabState.mockClear();
    mocks.hasCollabState.mockResolvedValue(true);
    mocks.seedFromText.mockClear();
  });

  it("loads the latest dashboard before applying queued full-text syncs", async () => {
    let dashboard = {
      config: { name: "Old dashboard" },
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    let releaseCollabRead!: (exists: boolean) => void;
    mocks.hasCollabState.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseCollabRead = resolve;
        }),
    );

    const firstSync = queueDashboardCollabSync(
      "traffic",
      dashboard.updatedAt,
      async () => dashboard,
      "agent",
    );
    await vi.waitFor(() => expect(mocks.hasCollabState).toHaveBeenCalledOnce());

    dashboard = {
      config: { name: "Latest dashboard" },
      updatedAt: "2026-10-06T00:00:01.000Z",
    };
    const secondSync = queueDashboardCollabSync(
      "traffic",
      dashboard.updatedAt,
      async () => dashboard,
      "agent",
    );

    releaseCollabRead(true);
    await Promise.all([firstSync, secondSync]);

    expect(mocks.applyText).toHaveBeenCalledTimes(2);
    expect(mocks.applyText).toHaveBeenNthCalledWith(
      1,
      "dash-traffic",
      JSON.stringify(dashboard.config),
      "content",
      "agent",
    );
    expect(mocks.applyText).toHaveBeenNthCalledWith(
      2,
      "dash-traffic",
      JSON.stringify(dashboard.config),
      "content",
      "agent",
    );
    expect(mocks.seedFromText).not.toHaveBeenCalled();
  });

  it("reapplies the latest dashboard if it changes during a collab write", async () => {
    let dashboard = {
      config: { name: "Older dashboard" },
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    let releaseApply!: () => void;
    mocks.applyText.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseApply = () => resolve(undefined);
        }),
    );

    const sync = queueDashboardCollabSync(
      "traffic",
      dashboard.updatedAt,
      async () => dashboard,
      "agent",
    );
    await vi.waitFor(() => expect(mocks.applyText).toHaveBeenCalledOnce());

    dashboard = {
      config: { name: "Latest dashboard" },
      updatedAt: "2026-10-06T00:00:01.000Z",
    };
    releaseApply();
    await sync;

    expect(mocks.applyText).toHaveBeenCalledTimes(2);
    expect(mocks.applyText).toHaveBeenNthCalledWith(
      1,
      "dash-traffic",
      JSON.stringify({ name: "Older dashboard" }),
      "content",
      "agent",
    );
    expect(mocks.applyText).toHaveBeenNthCalledWith(
      2,
      "dash-traffic",
      JSON.stringify({ name: "Latest dashboard" }),
      "content",
      "agent",
    );
  });

  it("releases the document queue on timeout and repairs a late stale write", async () => {
    vi.useFakeTimers();
    let dashboard = {
      config: { name: "Older dashboard" },
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    let releaseFirstApply!: () => void;
    let markFirstApplyStarted!: () => void;
    const firstApplyStarted = new Promise<void>((resolve) => {
      markFirstApplyStarted = resolve;
    });
    let markLateRepair!: () => void;
    const lateRepairApplied = new Promise<void>((resolve) => {
      markLateRepair = resolve;
    });
    let applyCount = 0;
    mocks.applyText.mockImplementation(() => {
      applyCount++;
      if (applyCount === 1) {
        markFirstApplyStarted();
        return new Promise<undefined>((resolve) => {
          releaseFirstApply = () => resolve(undefined);
        });
      }
      if (applyCount === 3) markLateRepair();
      return Promise.resolve(undefined);
    });

    try {
      const firstSync = queueDashboardCollabSync(
        "traffic",
        dashboard.updatedAt,
        async () => dashboard,
        "agent",
      );
      await firstApplyStarted;

      dashboard = {
        config: { name: "Latest dashboard" },
        updatedAt: "2026-10-06T00:00:01.000Z",
      };
      const secondSync = queueDashboardCollabSync(
        "traffic",
        dashboard.updatedAt,
        async () => dashboard,
        "agent",
      );

      await vi.advanceTimersByTimeAsync(DASHBOARD_COLLAB_SYNC_TIMEOUT_MS);
      await Promise.all([firstSync, secondSync]);
      expect(mocks.applyText).toHaveBeenCalledTimes(2);

      releaseFirstApply();
      await lateRepairApplied;

      expect(mocks.applyText).toHaveBeenCalledTimes(3);
      expect(mocks.applyText).toHaveBeenNthCalledWith(
        3,
        "dash-traffic",
        JSON.stringify({ name: "Latest dashboard" }),
        "content",
        "agent",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues one repair when a timed-out collab write rejects late", async () => {
    vi.useFakeTimers();
    let dashboard = {
      config: { name: "Older dashboard" },
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    let rejectFirstApply!: (error: Error) => void;
    let markFirstApplyStarted!: () => void;
    const firstApplyStarted = new Promise<void>((resolve) => {
      markFirstApplyStarted = resolve;
    });
    let markRepairApplied!: () => void;
    const repairApplied = new Promise<void>((resolve) => {
      markRepairApplied = resolve;
    });
    let applyCount = 0;
    mocks.applyText.mockImplementation(() => {
      applyCount++;
      if (applyCount === 1) {
        markFirstApplyStarted();
        return new Promise<undefined>((_, reject) => {
          rejectFirstApply = reject;
        });
      }
      if (applyCount === 3) markRepairApplied();
      return Promise.resolve(undefined);
    });

    try {
      const firstSync = queueDashboardCollabSync(
        "traffic",
        dashboard.updatedAt,
        async () => dashboard,
        "agent",
      );
      await firstApplyStarted;

      dashboard = {
        config: { name: "Latest dashboard" },
        updatedAt: "2026-10-06T00:00:01.000Z",
      };
      const secondSync = queueDashboardCollabSync(
        "traffic",
        dashboard.updatedAt,
        async () => dashboard,
        "agent",
      );

      await vi.advanceTimersByTimeAsync(DASHBOARD_COLLAB_SYNC_TIMEOUT_MS);
      await Promise.all([firstSync, secondSync]);
      expect(mocks.applyText).toHaveBeenCalledTimes(2);

      rejectFirstApply(new Error("late write result is uncertain"));
      await repairApplied;

      expect(mocks.applyText).toHaveBeenCalledTimes(3);
      expect(mocks.applyText).toHaveBeenNthCalledWith(
        3,
        "dash-traffic",
        JSON.stringify({ name: "Latest dashboard" }),
        "content",
        "agent",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
