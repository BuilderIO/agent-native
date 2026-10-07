import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  DashboardConflictError: class DashboardConflictError extends Error {},
  assertDashboardEditable: vi.fn(async (): Promise<void> => undefined),
  dryRunQuery: vi.fn(async (): Promise<string | null> => null),
  queueDashboardCollabSync: vi.fn(),
  resolvePanel: vi.fn(),
  track: vi.fn(),
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
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("../server/lib/dashboard-collab-sync", () => ({
  queueDashboardCollabSync: mocks.queueDashboardCollabSync,
}));
vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: mocks.dryRunQuery,
  dryRunQuerySchema: vi.fn(async () => ({ error: null })),
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));

// The store's contract (see dashboards-store.interleave.spec.ts): every write
// moves updatedAt, a fenced save lands only on the revision it was built from,
// and a save identical to what is stored persists nothing and returns the
// stored record untouched.
let row: { config: Record<string, unknown>; updatedAt: string } | null = null;
let version = 0;
let writes = 0;
const save = (config: Record<string, unknown>) => {
  writes += 1;
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
  if (!row || JSON.stringify(row.config) !== JSON.stringify(config)) {
    save(config);
  }
  return (await read())!;
};

vi.mock("../server/lib/dashboards-store", () => ({
  assertDashboardEditable: mocks.assertDashboardEditable,
  DashboardConflictError: mocks.DashboardConflictError,
  getDashboard: vi.fn(read),
  upsertDashboard: vi.fn(
    (
      id: string,
      _kind: string,
      config: Record<string, unknown>,
      _ctx: unknown,
      expectedUpdatedAt?: string,
    ) => write(id, config, expectedUpdatedAt),
  ),
  upsertDashboardWithRetry: vi.fn(
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
const SQL = "SELECT week, app, n FROM t";
const EDITED_SQL = "SELECT week, app, n FROM t LIMIT 5";
const ROWS = [
  { week: "2026-09-01", app: "mail", n: 10 },
  { week: "2026-09-08", app: "mail", n: 11 },
];

function panel(id: string, sql = SQL) {
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
const setSql = (sql: string) => ({
  ops: [{ op: "set" as const, path: "/panels/0/sql", value: sql }],
});

const identicalWrites: [string, Record<string, unknown>][] = [
  ["a config replace", { config: dashboard(panel("a"), panel("b")) }],
  ["a panelOrder reorder", { panelOrder: ["a"] }],
  ["an ops edit", setSql(SQL)],
];
const changingWrites: [string, Record<string, unknown>][] = [
  [
    "a config replace",
    { config: dashboard(panel("a", EDITED_SQL), panel("b")) },
  ],
  ["a panelOrder reorder", { panelOrder: ["b"] }],
  ["an ops edit", setSql(EDITED_SQL)],
];

beforeEach(() => {
  row = null;
  version = 0;
  writes = 0;
  save(dashboard(panel("a"), panel("b")));
  writes = 0;
  mocks.assertDashboardEditable.mockReset();
  mocks.assertDashboardEditable.mockResolvedValue(undefined);
  mocks.dryRunQuery.mockClear();
  mocks.queueDashboardCollabSync.mockClear();
  mocks.track.mockClear();
  mocks.resolvePanel.mockReset();
  mocks.resolvePanel.mockResolvedValue({
    rows: ROWS,
    schema: Object.keys(ROWS[0]).map((name) => ({ name, type: "STRING" })),
  });
});

describe("update-dashboard saves that change nothing", () => {
  describe.each(identicalWrites)(
    "%s that matches what is stored",
    (_, args) => {
      it("tells an agent nothing was saved, with a no-change receipt and where to look", async () => {
        const stored = row!.updatedAt;

        const result: any = await updateDashboard.run(
          { dashboardId: "growth", ...args } as never,
          agent,
        );

        expect(result).toMatchObject({
          saved: false,
          changed: false,
          updatedAt: stored,
          _receipt: {
            changed: false,
            verified: "unverified",
            subject: "growth",
          },
        });
        expect(result.summary).toContain("No dashboard changes were needed");
        expect(result.summary).toContain("inspect-dashboard-panel");
        expect(result).not.toHaveProperty("verified");
        expect(writes).toBe(0);
        expect(row!.updatedAt).toBe(stored);
        expect(mocks.queueDashboardCollabSync).not.toHaveBeenCalled();
        expect(mocks.track).not.toHaveBeenCalled();
        expect(mocks.resolvePanel).not.toHaveBeenCalled();
      });

      it("gives a UI caller the same unchanged result with no receipt or agent hint", async () => {
        const result: any = await updateDashboard.run(
          { dashboardId: "growth", ...args } as never,
          frontend,
        );

        expect(result).toMatchObject({
          saved: false,
          changed: false,
          updatedAt: row!.updatedAt,
        });
        expect(result.summary).toContain("No dashboard changes were needed");
        expect(result.summary).not.toContain("inspect-dashboard-panel");
        expect(result).not.toHaveProperty("_receipt");
        expect(writes).toBe(0);
        expect(mocks.queueDashboardCollabSync).not.toHaveBeenCalled();
        expect(mocks.track).not.toHaveBeenCalled();
      });
    },
  );

  describe.each(changingWrites)("%s that changes the dashboard", (_, args) => {
    it("still reports an agent save with the normal receipt, a sync, and tracking", async () => {
      const before = row!.updatedAt;

      const result: any = await updateDashboard.run(
        { dashboardId: "growth", ...args } as never,
        agent,
      );

      expect(result).toMatchObject({
        saved: true,
        changed: true,
        _receipt: { changed: true, subject: "growth" },
      });
      expect(result._receipt.summary).not.toContain("Nothing was written");
      expect(result.updatedAt).not.toBe(before);
      expect(writes).toBe(1);
      expect(mocks.queueDashboardCollabSync).toHaveBeenCalledOnce();
      expect(mocks.track).toHaveBeenCalledOnce();
    });

    it("reports a UI save as changed with no receipt", async () => {
      const result: any = await updateDashboard.run(
        { dashboardId: "growth", ...args } as never,
        frontend,
      );

      expect(result).toMatchObject({ saved: true, changed: true });
      expect(result).not.toHaveProperty("_receipt");
      expect(mocks.queueDashboardCollabSync).toHaveBeenCalledOnce();
    });
  });

  it("reports an ops edit a peer already landed during the retry as unchanged", async () => {
    // The first read is overtaken by a peer who saves the same edit.
    mocks.assertDashboardEditable.mockImplementationOnce(async () => {
      save(dashboard(panel("a", EDITED_SQL), panel("b")));
    });

    const result: any = await updateDashboard.run(
      { dashboardId: "growth", ...setSql(EDITED_SQL) },
      agent,
    );

    expect(result).toMatchObject({
      saved: false,
      changed: false,
      _receipt: { changed: false },
    });
    expect(writes).toBe(1);
    expect(mocks.queueDashboardCollabSync).not.toHaveBeenCalled();
  });

  it("still reports a UI save as changed when it reverts a peer's write that landed after it loaded the config", async () => {
    const loaded = structuredClone(row!.config);
    let peer = "";
    mocks.dryRunQuery.mockImplementationOnce(async () => {
      save(dashboard(panel("a", EDITED_SQL), panel("b")));
      peer = row!.updatedAt;
      return null;
    });

    const result: any = await updateDashboard.run(
      { dashboardId: "growth", config: loaded },
      frontend,
    );

    expect(result).toMatchObject({ saved: true, changed: true });
    expect(result.updatedAt).not.toBe(peer);
    expect(row!.config).toEqual(loaded);
    expect(mocks.queueDashboardCollabSync).toHaveBeenCalledOnce();
  });

  it("reports a brand-new dashboard as saved", async () => {
    row = null;

    const result: any = await updateDashboard.run(
      { dashboardId: "fresh", config: dashboard(panel("a")) },
      agent,
    );

    expect(result).toMatchObject({
      saved: true,
      changed: true,
      _receipt: { changed: true },
    });
    expect(mocks.queueDashboardCollabSync).toHaveBeenCalledOnce();
  });
});
