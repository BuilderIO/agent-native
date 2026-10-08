import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  DashboardConflictError: class DashboardConflictError extends Error {},
  assertDashboardEditable: vi.fn(async (): Promise<void> => undefined),
  dryRunQuery: vi.fn(async (): Promise<string | null> => null),
  resolvePanel: vi.fn(),
}));

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  embedApp: vi.fn((value: unknown) => value),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  buildDeepLink: () => "/analytics/adhoc",
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getCredentialContext: () => ({
      userEmail: "alice@example.com",
      orgId: null,
    }),
  }),
);
vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(async () => undefined),
  hasCollabState: vi.fn(async () => false),
  seedFromText: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: mocks.dryRunQuery,
  dryRunQuerySchema: vi.fn(async () => ({ error: null })),
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));

// A store with the real revision fence: a fenced save lands only on the
// updatedAt it was derived from, and the retry helper re-reads and re-runs the
// mutation on a lost race like upsertDashboardWithRetryOutcome does.
let row: { config: Record<string, unknown>; updatedAt: string } | null = null;
let version = 0;
const save = (config: Record<string, unknown>) => {
  row = { config: structuredClone(config), updatedAt: `v${++version}` };
};
const read = async () =>
  row
    ? {
        kind: "sql",
        config: structuredClone(row.config),
        updatedAt: row.updatedAt,
      }
    : null;
const write = async (
  id: string,
  config: Record<string, unknown>,
  expectedUpdatedAt?: string,
) => {
  if (
    expectedUpdatedAt !== undefined &&
    (!row || row.updatedAt !== expectedUpdatedAt)
  ) {
    throw new mocks.DashboardConflictError(id);
  }
  if (row && JSON.stringify(row.config) === JSON.stringify(config)) {
    return { dashboard: { ...row }, didWrite: false };
  }
  save(config);
  return { dashboard: { ...row! }, didWrite: true };
};

vi.mock("../server/lib/dashboards-store", () => ({
  assertDashboardEditable: mocks.assertDashboardEditable,
  DashboardConflictError: mocks.DashboardConflictError,
  getDashboard: vi.fn(read),
  upsertDashboardOutcome: vi.fn(
    (
      id: string,
      _kind: string,
      config: Record<string, unknown>,
      _ctx: unknown,
      expectedUpdatedAt?: string,
    ) => write(id, config, expectedUpdatedAt),
  ),
  upsertDashboardWithRetryOutcome: vi.fn(
    async (
      id: string,
      _ctx: unknown,
      mutate: (existing: any) => Promise<{ body: Record<string, unknown> }>,
    ) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = (await read())!;
        const { body } = await mutate(existing);
        try {
          return await write(id, body, existing.updatedAt);
        } catch (err) {
          if (!(err instanceof mocks.DashboardConflictError)) throw err;
        }
      }
      throw new Error("kept changing concurrently");
    },
  ),
}));

const { default: updateDashboard } = await import("./update-dashboard");

const agent = { caller: "tool" } as never;
const frontend = { caller: "frontend" } as never;
const ROWS = [
  { week: "2026-09-01", app: "mail", n: 10 },
  { week: "2026-09-08", app: "mail", n: 11 },
];

function result(rows: Record<string, unknown>[]) {
  return {
    rows,
    schema: Object.keys(rows[0] ?? {}).map((name) => ({
      name,
      type: "STRING",
    })),
  };
}

function panel(id: string, sql = "SELECT week, app, n FROM t") {
  return {
    id,
    title: id,
    source: "bigquery",
    chartType: "line",
    width: 2,
    sql,
    config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } },
  };
}

const dashboard = (...panels: Record<string, unknown>[]) => ({
  name: "Growth",
  panels,
});
const panelIds = () =>
  (row!.config.panels as Array<{ id: string }>).map(({ id }) => id);

beforeEach(() => {
  row = null;
  version = 0;
  mocks.assertDashboardEditable.mockReset();
  mocks.assertDashboardEditable.mockResolvedValue(undefined);
  mocks.dryRunQuery.mockReset();
  mocks.dryRunQuery.mockResolvedValue(null);
  mocks.resolvePanel.mockReset();
  mocks.resolvePanel.mockResolvedValue(result(ROWS));
});

describe("update-dashboard saves that outlive their read", () => {
  const edited = () => dashboard(panel("a", "SELECT week, app, n FROM t2"));
  const concurrent = () => dashboard(panel("a"), panel("added-elsewhere"));

  describe("config replace", () => {
    it("rejects an agent save that another writer overtook while its panels were verified", async () => {
      save(dashboard(panel("a")));
      const concurrentVersion = concurrent();
      mocks.resolvePanel.mockImplementationOnce(async () => {
        save(concurrentVersion);
        return result(ROWS);
      });

      await expect(
        updateDashboard.run({ dashboardId: "growth", config: edited() }, agent),
      ).rejects.toMatchObject({
        errorCode: "dashboard_conflict",
        statusCode: 409,
      });

      expect(row!.config).toEqual(concurrentVersion);
    });

    it("saves the agent's replacement when nothing changed in between", async () => {
      save(dashboard(panel("a")));

      const saved: any = await updateDashboard.run(
        { dashboardId: "growth", config: edited() },
        agent,
      );

      expect(saved.verified).toBe(true);
      expect(row!.config).toEqual(edited());
    });

    it("keeps the caller's own expectedUpdatedAt as the fence", async () => {
      save(dashboard(panel("a")));
      const stale = row!.updatedAt;
      save(concurrent());

      await expect(
        updateDashboard.run(
          { dashboardId: "growth", config: edited(), expectedUpdatedAt: stale },
          agent,
        ),
      ).rejects.toMatchObject({ errorCode: "dashboard_conflict" });
      expect(panelIds()).toEqual(["a", "added-elsewhere"]);
    });

    it("keeps a UI save that sends no revision on last-write-wins", async () => {
      save(dashboard(panel("a")));
      mocks.dryRunQuery.mockImplementationOnce(async () => {
        save(concurrent());
        return null;
      });

      await updateDashboard.run(
        { dashboardId: "growth", config: edited() },
        frontend,
      );

      expect(row!.config).toEqual(edited());
    });
  });

  describe("ops", () => {
    it("re-reads and reapplies the edit when another writer lands during verification", async () => {
      save(dashboard(panel("a")));
      mocks.resolvePanel.mockImplementationOnce(async () => {
        save(concurrent());
        return result(ROWS);
      });

      const saved: any = await updateDashboard.run(
        {
          dashboardId: "growth",
          ops: [
            {
              op: "set",
              path: "/panels/0/sql",
              value: "SELECT week, app, n FROM t2",
            },
          ],
        },
        agent,
      );

      expect(saved.verified).toBe(true);
      expect(panelIds()).toEqual(["a", "added-elsewhere"]);
      expect((row!.config.panels as Array<{ sql: string }>)[0].sql).toBe(
        "SELECT week, app, n FROM t2",
      );
    });
  });

  describe("panelOrder", () => {
    it("reorders the freshest panel list when another writer adds a panel mid-save", async () => {
      save(dashboard(panel("a"), panel("b")));
      mocks.assertDashboardEditable.mockImplementationOnce(async () => {
        save(dashboard(panel("a"), panel("b"), panel("c")));
      });

      await updateDashboard.run(
        { dashboardId: "growth", panelOrder: ["b"] },
        agent,
      );

      expect(panelIds()).toEqual(["b", "a", "c"]);
    });
  });
});
