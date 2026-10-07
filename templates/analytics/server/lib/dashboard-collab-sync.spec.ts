import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyText: vi.fn(async (..._args: unknown[]) => undefined),
  getText: vi.fn(async (..._args: unknown[]) => ""),
}));

vi.mock("@agent-native/core/collab", () => mocks);

const { DASHBOARD_COLLAB_SYNC_TIMEOUT_MS, queueDashboardCollabSync } =
  await import("./dashboard-collab-sync");

describe("dashboard collab sync", () => {
  beforeEach(() => {
    mocks.applyText.mockClear();
    mocks.getText.mockClear();
  });

  it("loads the latest dashboard before applying queued full-text syncs", async () => {
    let dashboard = {
      config: { name: "Old dashboard" },
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    let releaseDashboardRead!: () => void;
    let markDashboardReadStarted!: () => void;
    const dashboardReadStarted = new Promise<void>((resolve) => {
      markDashboardReadStarted = resolve;
    });
    let readCount = 0;
    const loadDashboard = async () => {
      if (readCount++ === 0) {
        markDashboardReadStarted();
        await new Promise<void>((resolve) => {
          releaseDashboardRead = resolve;
        });
      }
      return dashboard;
    };

    const firstSync = queueDashboardCollabSync(
      "traffic",
      dashboard.updatedAt,
      loadDashboard,
      "agent",
    );
    await dashboardReadStarted;

    dashboard = {
      config: { name: "Latest dashboard" },
      updatedAt: "2026-10-06T00:00:01.000Z",
    };
    const secondSync = queueDashboardCollabSync(
      "traffic",
      dashboard.updatedAt,
      loadDashboard,
      "agent",
    );

    releaseDashboardRead();
    await Promise.all([firstSync, secondSync]);

    expect(mocks.applyText).toHaveBeenCalledTimes(2);
    expect(mocks.applyText.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ["dash-traffic", JSON.stringify(dashboard.config), "content", "agent"],
      ["dash-traffic", JSON.stringify(dashboard.config), "content", "agent"],
    ]);
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
    expect(mocks.applyText.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      [
        "dash-traffic",
        JSON.stringify({ name: "Older dashboard" }),
        "content",
        "agent",
      ],
      [
        "dash-traffic",
        JSON.stringify({ name: "Latest dashboard" }),
        "content",
        "agent",
      ],
    ]);
  });

  it("retries when the merged Yjs snapshot differs from the dashboard", async () => {
    const dashboard = {
      config: { name: "Latest dashboard" },
      updatedAt: "2026-10-06T00:00:01.000Z",
    };
    let applyCount = 0;
    mocks.applyText.mockImplementation(async (...args: unknown[]) => {
      applyCount++;
      const requestedText = args[1] as string;
      const options = args[4] as {
        validateSnapshot: (snapshot: string) => void;
      };
      options.validateSnapshot(
        applyCount === 1 ? "merged peer snapshot" : requestedText,
      );
      return undefined;
    });

    await queueDashboardCollabSync(
      "traffic",
      dashboard.updatedAt,
      async () => dashboard,
      "agent",
    );

    expect(applyCount).toBe(2);
    expect(mocks.applyText.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ["dash-traffic", JSON.stringify(dashboard.config), "content", "agent"],
      ["dash-traffic", JSON.stringify(dashboard.config), "content", "agent"],
    ]);
  });

  it("refreshes persisted Yjs text before accepting a cached no-op", async () => {
    const config = { name: "SQL dashboard" };
    const sqlText = JSON.stringify(config);
    let localYDocText = sqlText;
    const persistedYDocText = JSON.stringify({ name: "Peer edit" });

    mocks.getText.mockImplementation(async () => {
      localYDocText = persistedYDocText;
      return localYDocText;
    });
    mocks.applyText.mockImplementation(async (...args: unknown[]) => {
      const requestedText = args[1] as string;
      const options = args[4] as {
        validateSnapshot: (snapshot: string) => void;
      };
      if (localYDocText !== requestedText) localYDocText = requestedText;
      options.validateSnapshot(localYDocText);
      return undefined;
    });

    await queueDashboardCollabSync(
      "traffic",
      "2026-10-06T00:00:01.000Z",
      async () => ({ config, updatedAt: "2026-10-06T00:00:01.000Z" }),
      "agent",
    );

    expect(mocks.getText).toHaveBeenCalledWith("dash-traffic", "content");
    expect(mocks.applyText).toHaveBeenCalledOnce();
    expect(mocks.getText.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyText.mock.invocationCallOrder[0],
    );
    expect(localYDocText).toBe(sqlText);
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
      expect(mocks.applyText.mock.calls[2]?.slice(0, 4)).toEqual([
        "dash-traffic",
        JSON.stringify({ name: "Latest dashboard" }),
        "content",
        "agent",
      ]);
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
      expect(mocks.applyText.mock.calls[2]?.slice(0, 4)).toEqual([
        "dash-traffic",
        JSON.stringify({ name: "Latest dashboard" }),
        "content",
        "agent",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
