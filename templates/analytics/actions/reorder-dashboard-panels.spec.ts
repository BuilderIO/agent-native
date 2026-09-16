import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({ archivedAt: null })),
  upsertDashboardWithRetry: vi.fn(),
  hasCollabState: vi.fn(async () => false),
  applyText: vi.fn(async () => undefined),
  seedFromText: vi.fn(async () => undefined),
}));

/**
 * Default passthrough: fetch via the mocked `getDashboard`, run the action's
 * mutate callback once against it, then forward to the mocked
 * `upsertDashboard` (preserving every existing `.mock.calls` assertion below)
 * and return a DashboardRecord-shaped result carrying the mutated config.
 * Individual tests override this with `mockImplementationOnce` to simulate a
 * lost race and prove the action recomputes from fresh state on retry.
 */
function defaultUpsertDashboardWithRetry(
  id: string,
  ctx: unknown,
  mutate: (existing: any) =>
    | Promise<{ kind: string; body: unknown }>
    | {
        kind: string;
        body: unknown;
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
    return { ...existing, kind, config: body };
  })();
}

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({
      app,
      view,
      params,
    }: {
      app: string;
      view: string;
      params?: { dashboardId?: string };
    }) => {
      const suffix = params?.dashboardId ? `/${params.dashboardId}` : "";
      return `/${app}/${view}${suffix}`;
    },
  ),
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

const { default: reorderDashboardPanels } =
  await import("./reorder-dashboard-panels");

function panel(id: string) {
  return {
    id,
    title: id,
    source: "first-party",
    chartType: "metric",
    width: 1,
    sql: "SELECT COUNT(*) AS value FROM analytics_events",
  };
}

describe("reorder-dashboard-panels", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.upsertDashboardWithRetry.mockReset();
    mocks.upsertDashboardWithRetry.mockImplementation(
      defaultUpsertDashboardWithRetry,
    );
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
  });

  it("moves requested panel ids to the top in the requested order", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [
          panel("a"),
          panel("b"),
          panel("dau"),
          panel("wau"),
          panel("c"),
        ],
      },
    });

    const result: any = await reorderDashboardPanels.run({
      dashboardId: "traffic",
      panelIds: ["dau", "wau"],
    });

    expect(result.panelOrder).toEqual(["dau", "wau", "a", "b", "c"]);
    expect(result.firstPanelIds).toEqual(["dau", "wau", "a", "b", "c"]);
    expect(result.config).toBeUndefined();
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual([
      "dau",
      "wau",
      "a",
      "b",
      "c",
    ]);
  });

  it("can move panels before another panel id", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [panel("a"), panel("b"), panel("c"), panel("d")],
      },
    });

    const result: any = await reorderDashboardPanels.run({
      dashboardId: "traffic",
      panelIds: ["d"],
      beforePanelId: "b",
    });

    expect(result.panelOrder).toEqual(["a", "d", "b", "c"]);
    expect(result.insertIndex).toBe(1);
  });

  it("rejects unknown panel ids without saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [panel("a"), panel("b")],
      },
    });

    await expect(
      reorderDashboardPanels.run({
        dashboardId: "traffic",
        panelIds: ["missing"],
      }),
    ).rejects.toThrow(/panel id\(s\) not found: missing/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("recomputes the move against fresh state on retry so a concurrent writer's save is never dropped", async () => {
    // Simulates two interleaved writers: this call is asked to move "c" to
    // the top, but loses the race on its first fenced write because a
    // concurrent writer already saved a different reorder (moving "b" to the
    // top) in between. A correct retry re-reads that winning save and
    // reapplies "move c to top" on top of it, landing both writers' edits.
    const beforeConcurrentWrite = {
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [panel("a"), panel("b"), panel("c")],
      },
    };
    const afterConcurrentWrite = {
      kind: "sql",
      config: {
        name: "Traffic",
        panels: [panel("b"), panel("a"), panel("c")],
      },
    };

    let mutateCallCount = 0;
    mocks.upsertDashboardWithRetry.mockImplementationOnce(
      async (id: string, ctx: unknown, mutate: (existing: any) => any) => {
        // Attempt 1: computed against the stale pre-race snapshot, then lost
        // to the concurrent writer's fenced write (never applied).
        mutateCallCount += 1;
        await mutate(beforeConcurrentWrite);
        // Attempt 2 (retry): re-fetches and recomputes against the fresh
        // config that already contains the concurrent writer's change.
        mutateCallCount += 1;
        const { kind, body } = await mutate(afterConcurrentWrite);
        await mocks.upsertDashboard(id, kind, body, ctx);
        return { ...afterConcurrentWrite, kind, config: body };
      },
    );

    const result: any = await reorderDashboardPanels.run({
      dashboardId: "traffic",
      panelIds: ["c"],
      position: "top",
    });

    expect(mutateCallCount).toBe(2);
    // Both writers' moves landed: "c" from this call on top of "b" from the
    // concurrent writer, instead of "c" clobbering "b"'s reorder.
    expect(result.panelOrder).toEqual(["c", "b", "a"]);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});
