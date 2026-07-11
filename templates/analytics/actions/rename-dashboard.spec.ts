import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  upsertDashboardWithRetry: vi.fn(),
  hasCollabState: vi.fn(async () => false),
  applyText: vi.fn(async () => undefined),
  seedFromText: vi.fn(async () => undefined),
}));

/**
 * Default passthrough: fetch via the mocked `getDashboard`, run the action's
 * mutate callback once against it, then forward to the mocked
 * `upsertDashboard` and return a DashboardRecord-shaped result carrying the
 * mutated config/title. Individual tests override this with
 * `mockImplementationOnce` to simulate a lost race and prove the action
 * recomputes the rename from fresh state on retry.
 */
function defaultUpsertDashboardWithRetry(
  id: string,
  ctx: unknown,
  mutate: (existing: any) =>
    | Promise<{ kind: string; body: any }>
    | {
        kind: string;
        body: any;
      },
) {
  return (async () => {
    const existing = await mocks.getDashboard(id, ctx);
    if (!existing) {
      throw new Error(
        `dashboard "${id}" not found (or you don't have access).`,
      );
    }
    const { kind, body } = await mutate(existing);
    await mocks.upsertDashboard(id, kind, body, ctx);
    return { ...existing, kind, config: body, title: body.name };
  })();
}

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return { ...actual };
});

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
  upsertDashboardWithRetry: mocks.upsertDashboardWithRetry,
}));

const { default: renameDashboard } = await import("./rename-dashboard");

function dashboardConfig(name = "Traffic") {
  return {
    name,
    columns: 2,
    panels: [{ id: "a", title: "a" }],
  };
}

describe("rename-dashboard", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockReset();
    mocks.upsertDashboardWithRetry.mockReset();
    mocks.upsertDashboardWithRetry.mockImplementation(
      defaultUpsertDashboardWithRetry,
    );
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
  });

  it("renames a dashboard through the fenced retry helper", async () => {
    mocks.getDashboard.mockResolvedValue({
      id: "traffic",
      kind: "sql",
      config: dashboardConfig(),
      updatedAt: "2026-07-09T00:00:00.000Z",
    });

    const result: any = await renameDashboard.run({
      id: "traffic",
      name: "New Name",
    });

    expect(result).toEqual({ id: "traffic", name: "New Name" });
    expect(mocks.upsertDashboardWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const [, savedKind, savedBody] = mocks.upsertDashboard.mock.calls[0];
    expect(savedKind).toBe("sql");
    expect(savedBody).toEqual({ ...dashboardConfig(), name: "New Name" });
  });

  it("rejects a blank name without touching the store", async () => {
    await expect(
      renameDashboard.run({ id: "traffic", name: "   " }),
    ).rejects.toThrow(/name is required/);

    expect(mocks.upsertDashboardWithRetry).not.toHaveBeenCalled();
  });

  it("recomputes the rename against fresh state on retry so a concurrent panel edit is never dropped", async () => {
    // Simulates two interleaved writers racing on the same dashboard: this
    // call renames the dashboard, but its first fenced write is lost because
    // a concurrent panel edit (mutate-dashboard/update-dashboard) already
    // saved a new panel in between. A correct retry re-reads that winning
    // save and reapplies the rename on top of it, so both the new panel and
    // the new name land instead of the rename clobbering the panel edit with
    // a stale config snapshot.
    const beforeConcurrentWrite = {
      id: "traffic",
      kind: "sql",
      config: dashboardConfig(),
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
    const afterConcurrentWrite = {
      id: "traffic",
      kind: "sql",
      config: {
        ...dashboardConfig(),
        panels: [...dashboardConfig().panels, { id: "b", title: "b" }],
      },
      updatedAt: "2026-07-09T00:00:00.001Z",
    };

    let mutateCallCount = 0;
    mocks.upsertDashboardWithRetry.mockImplementationOnce(
      async (id: string, ctx: unknown, mutate: (existing: any) => any) => {
        mutateCallCount += 1;
        await mutate(beforeConcurrentWrite); // attempt 1: lost to the race
        mutateCallCount += 1;
        const { kind, body } = await mutate(afterConcurrentWrite); // retry
        await mocks.upsertDashboard(id, kind, body, ctx);
        return {
          ...afterConcurrentWrite,
          kind,
          config: body,
          title: body.name,
        };
      },
    );

    const result: any = await renameDashboard.run({
      id: "traffic",
      name: "Renamed While Racing",
    });

    expect(mutateCallCount).toBe(2);
    expect(result).toEqual({ id: "traffic", name: "Renamed While Racing" });
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      name: string;
      panels: Array<{ id: string }>;
    };
    // Both writers' changes are present: the concurrent panel add ("b") and
    // this call's own rename.
    expect(saved.panels.map((p) => p.id)).toEqual(["a", "b"]);
    expect(saved.name).toBe("Renamed While Racing");
  });

  it("syncs the persisted config to collab after a successful save", async () => {
    mocks.getDashboard.mockResolvedValue({
      id: "traffic",
      kind: "sql",
      config: dashboardConfig(),
      updatedAt: "2026-07-09T00:00:00.000Z",
    });

    await renameDashboard.run({ id: "traffic", name: "New Name" });

    expect(mocks.hasCollabState).toHaveBeenCalledWith("dash-traffic");
    expect(mocks.seedFromText).toHaveBeenCalledTimes(1);
    const seededConfig = JSON.parse(mocks.seedFromText.mock.calls[0][1]);
    expect(seededConfig.name).toBe("New Name");
  });
});
