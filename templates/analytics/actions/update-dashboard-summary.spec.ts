import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({ archivedAt: null })),
  upsertDashboardWithRetry: vi.fn(),
  dryRunQuery: vi.fn(),
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

vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: mocks.dryRunQuery,
}));

const { default: updateDashboard } = await import("./update-dashboard");

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

describe("update-dashboard proof-of-done summary", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.upsertDashboardWithRetry.mockReset();
    mocks.upsertDashboardWithRetry.mockImplementation(
      defaultUpsertDashboardWithRetry,
    );
    mocks.dryRunQuery.mockReset();
    mocks.dryRunQuery.mockResolvedValue(null);
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
  });

  it("is exposed to the dashboard editor's browser action client", () => {
    expect(updateDashboard.http).toEqual({ method: "POST" });
  });

  it("returns panelCount + summary on a full config replace", async () => {
    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      config: {
        name: "Weekly",
        panels: [panel("a"), panel("b"), panel("c")],
      },
    });

    expect(result.panelCount).toBe(3);
    expect(result.appliedOps).toBe(0);
    expect(result.summary).toMatch(/3 panel/);
    expect(result.config).toBeUndefined();
    expect(result.firstPanelIds).toEqual(["a", "b", "c"]);
  });

  it("can include the full config when explicitly requested", async () => {
    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      returnConfig: true,
      config: {
        name: "Weekly",
        panels: [panel("a")],
      },
    });

    expect(result.config).toBeDefined();
    expect(result.panelOrder).toEqual(["a"]);
  });

  it("returns appliedOps + resulting panelCount after batched insert ops", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a")] },
    });

    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      ops: [
        { op: "insert", path: "/panels/-", value: panel("b") },
        { op: "insert", path: "/panels/-", value: panel("c") },
      ],
    });

    expect(result.appliedOps).toBe(2);
    expect(result.panelCount).toBe(3);
    expect(result.summary).toMatch(/Applied 2 op\(s\)/);
    expect(result.summary).toMatch(/3 panel/);
    // Saved once, atomically, with all three panels.
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(result.config).toBeUndefined();
    expect(result.panelOrder).toEqual(["a", "b", "c"]);
  });

  it("supports id alias plus panelOrder for simple panel reorders", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a"), panel("b"), panel("c")] },
    });

    const result: any = await updateDashboard.run({
      id: "weekly",
      panelOrder: ["c", "a"],
    });

    expect(mocks.dryRunQuery).not.toHaveBeenCalled();
    expect(result.panelOrder).toEqual(["c", "a", "b"]);
    expect(result.firstPanelIds).toEqual(["c", "a", "b"]);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("accepts panelOrder as a JSON string for shell and legacy callers", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a"), panel("b"), panel("c")] },
    });

    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      panelOrder: '["b","c"]',
    });

    expect(result.panelOrder).toEqual(["b", "c", "a"]);
  });

  it("validates dashboard config after ops before saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a")] },
    });

    await expect(
      updateDashboard.run({
        dashboardId: "weekly",
        ops: [{ op: "remove", path: "/panels/0/title" }],
      }),
    ).rejects.toThrow(/panel\[0\]\.title is required/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("recomputes ops against fresh state on retry so a concurrent writer's insert is never dropped", async () => {
    // Simulates two interleaved writers: this call inserts panel "b" at the
    // end via a JSON-pointer op, but its first fenced write is lost because a
    // concurrent writer already saved a different insert ("writer-a") in
    // between. A correct retry re-reads that winning save and reapplies the
    // same op on top of it, so both inserts land.
    const beforeConcurrentWrite = {
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a")] },
    };
    const afterConcurrentWrite = {
      kind: "sql",
      config: { name: "Weekly", panels: [panel("a"), panel("writer-a")] },
    };

    let mutateCallCount = 0;
    mocks.upsertDashboardWithRetry.mockImplementationOnce(
      async (id: string, ctx: unknown, mutate: (existing: any) => any) => {
        mutateCallCount += 1;
        await mutate(beforeConcurrentWrite); // attempt 1: lost to the race
        mutateCallCount += 1;
        const { kind, body } = await mutate(afterConcurrentWrite); // retry
        await mocks.upsertDashboard(id, kind, body, ctx);
        return { ...afterConcurrentWrite, kind, config: body };
      },
    );

    const result: any = await updateDashboard.run({
      dashboardId: "weekly",
      ops: [{ op: "insert", path: "/panels/-", value: panel("writer-b") }],
    });

    expect(mutateCallCount).toBe(2);
    expect(result.panelOrder).toEqual(["a", "writer-a", "writer-b"]);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual([
      "a",
      "writer-a",
      "writer-b",
    ]);
  });
});
