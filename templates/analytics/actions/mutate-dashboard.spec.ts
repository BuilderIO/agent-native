import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDashboardPanelGroups } from "../app/pages/adhoc/sql-dashboard/dashboard-layout";
import {
  clampDashboardColumns,
  type SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";

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

const { default: mutateDashboard } = await import("./mutate-dashboard");

function panel(id: string, source = "first-party") {
  return {
    id,
    title: id,
    source,
    chartType: "metric",
    width: 1,
    sql:
      source === "bigquery"
        ? "SELECT COUNT(*) AS value FROM `project.dataset.table`"
        : "SELECT COUNT(*) AS value FROM analytics_events WHERE event_date >= '2020-01-01'",
  };
}

function dashboardConfig() {
  return {
    name: "Traffic",
    columns: 2,
    panels: [panel("a"), panel("b"), panel("c")],
  };
}

function renderedRows(root: { columns?: number; panels: unknown[] }) {
  return buildDashboardPanelGroups(
    root.panels as SqlPanel[],
    clampDashboardColumns(root.columns),
  ).flatMap((group) => group.rows.map((row) => row.panels.map((p) => p.id)));
}

describe("mutate-dashboard", () => {
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

  it.each([[], ""])(
    "ignores an empty auto-serialized operations sibling (%j) when code is present",
    async (emptyOperations) => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: dashboardConfig(),
      });

      const args = mutateDashboard.schema.parse({
        dashboardId: "traffic",
        id: "",
        code: 'dashboard.panel("a").setTitle("Alpha");',
        operations: emptyOperations,
        dryRun: false,
        returnTypes: false,
        returnConfig: false,
      });
      const result: any = await mutateDashboard.run(args);

      expect(result.changedPanelIds).toEqual(["a"]);
      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
    },
  );

  it("ignores an empty auto-serialized code sibling when operations are present", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    const args = mutateDashboard.schema.parse({
      dashboardId: "traffic",
      id: "",
      code: "",
      operations: [
        {
          op: "updatePanel",
          panelId: "a",
          patch: { title: "Alpha" },
        },
      ],
      dryRun: false,
      returnTypes: false,
      returnConfig: false,
    });
    const result: any = await mutateDashboard.run(args);

    expect(result.changedPanelIds).toEqual(["a"]);
    expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
  });

  it("applies a typed mutation script in one atomic save", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      code: [
        'dashboard.panels(["b","c"]).moveToTop();',
        'dashboard.panel("a").setTitle("Alpha");',
      ].join("\n"),
    });

    expect(result.saved).toBe(true);
    expect(result.appliedOps).toBe(2);
    expect(result.panelOrder).toEqual(["b", "c", "a"]);
    expect(result.changedPanelIds).toEqual(["b", "c", "a"]);
    expect(result.commandLog).toEqual([
      "movePanels(b, c) -> index 0",
      "updatePanel(a: title)",
    ]);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string; title: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(saved.panels[2].title).toBe("Alpha");
    expect(mocks.dryRunQuery).not.toHaveBeenCalled();
  });

  it("advertises one unambiguous code input to the agent", () => {
    const parameters = mutateDashboard.tool.parameters as {
      properties: Record<string, { minLength?: number }>;
      required: string[];
    };

    expect(Object.keys(parameters.properties)).toEqual(["dashboardId", "code"]);
    expect(parameters.required).toEqual(["dashboardId", "code"]);
    expect(parameters.properties.dashboardId.minLength).toBe(1);
    expect(parameters.properties.code.minLength).toBe(1);
  });

  it("accepts structured operations and can dry-run without saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      dryRun: true,
      operations: [
        {
          op: "updatePanel",
          panelId: "a",
          patch: { title: "Dry Run Alpha" },
        },
      ],
    });

    expect(result.saved).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.changedPanelIds).toEqual(["a"]);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    expect(mocks.applyText).not.toHaveBeenCalled();
    expect(mocks.seedFromText).not.toHaveBeenCalled();
  });

  it("accepts row-aware structured placement operations", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      operations: [
        {
          op: "insertPanel",
          panel: panel("new"),
          nextToPanelId: "b",
        },
      ],
    });

    expect(result.saved).toBe(true);
    expect(result.panelOrder).toEqual(["a", "b", "new", "c"]);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      columns: number;
      panels: Array<{ id: string }>;
    };
    expect(saved.columns).toBe(3);
    expect(renderedRows(saved)).toEqual([["a", "b", "new"], ["c"]]);
  });

  it("validates SQL-affecting mutations before saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        ...dashboardConfig(),
        panels: [panel("a", "bigquery")],
      },
    });
    mocks.dryRunQuery.mockResolvedValue("bad column");

    await expect(
      mutateDashboard.run({
        dashboardId: "traffic",
        code: 'dashboard.panel("a").setSql("SELECT bad_column FROM `project.dataset.table`");',
      }),
    ).rejects.toThrow(/SQL is invalid: bad column/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("does not let unrelated legacy-invalid SQL block a valid duplicate", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        ...dashboardConfig(),
        panels: [
          panel("valid", "bigquery"),
          {
            ...panel("legacy-invalid", "bigquery"),
            sql: "SELECT legacy_bad_column FROM `project.dataset.table`",
          },
        ],
      },
    });
    mocks.dryRunQuery.mockImplementation(async (sql: string) =>
      sql.includes("legacy_bad_column") ? "bad column" : null,
    );

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      code: 'dashboard.panel("valid").duplicate("valid-bar", {"chartType":"bar"}).nextTo("valid");',
    });

    expect(result.saved).toBe(true);
    expect(result.insertedPanelIds).toEqual(["valid-bar"]);
    expect(result.panelOrder).toEqual(["valid", "valid-bar", "legacy-invalid"]);
    expect(mocks.dryRunQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dryRunQuery.mock.calls[0][0]).not.toContain(
      "legacy_bad_column",
    );
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
  });

  it("revalidates every panel when dashboard filters change", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        ...dashboardConfig(),
        panels: [
          panel("valid", "bigquery"),
          {
            ...panel("legacy-invalid", "bigquery"),
            sql: "SELECT legacy_bad_column FROM `project.dataset.table`",
          },
        ],
      },
    });
    mocks.dryRunQuery.mockImplementation(async (sql: string) =>
      sql.includes("legacy_bad_column") ? "bad column" : null,
    );

    await expect(
      mutateDashboard.run({
        dashboardId: "traffic",
        code: 'dashboard.set({"filters":[]});',
      }),
    ).rejects.toThrow(/legacy-invalid.*SQL is invalid: bad column/);

    expect(mocks.dryRunQuery).toHaveBeenCalledTimes(2);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("sets a filter default without validating unrelated legacy-invalid SQL", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        ...dashboardConfig(),
        filters: [
          {
            id: "emailFilter",
            type: "select",
            default: "all",
            options: [
              { value: "all", label: "All users" },
              { value: "exclude_builder", label: "Exclude @builder.io" },
            ],
          },
        ],
        panels: [
          panel("valid", "bigquery"),
          {
            ...panel("legacy-invalid", "bigquery"),
            sql: "SELECT legacy_bad_column FROM `project.dataset.table`",
          },
        ],
      },
    });
    mocks.dryRunQuery.mockImplementation(async (sql: string) =>
      sql.includes("legacy_bad_column") ? "bad column" : null,
    );

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      code: 'dashboard.setFilterDefault("emailFilter","exclude_builder");',
    });

    expect(result.saved).toBe(true);
    expect(result.dashboardFieldsChanged).toEqual([
      "filters.emailFilter.default",
    ]);
    expect(result.commandLog).toEqual([
      'setFilterDefault(emailFilter: "exclude_builder")',
    ]);
    expect(mocks.dryRunQuery).not.toHaveBeenCalled();
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      filters: Array<{ id: string; default: string }>;
    };
    expect(saved.filters).toEqual([
      expect.objectContaining({
        id: "emailFilter",
        default: "exclude_builder",
      }),
    ]);
  });

  it("rejects missing panels without saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    await expect(
      mutateDashboard.run({
        dashboardId: "traffic",
        code: 'dashboard.panel("missing").setTitle("Nope");',
      }),
    ).rejects.toThrow(/panel "missing" was not found/);

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("can return the allowed API types without a dashboard id", async () => {
    const result: any = await mutateDashboard.run({ returnTypes: true });

    expect(result.apiTypes).toContain("type DashboardScript");
    expect(result.examples[0]).toContain("moveToTop");
    expect(mocks.getDashboard).not.toHaveBeenCalled();
  });

  it("recomputes the mutation against fresh state on retry so a concurrent writer's panel is never dropped", async () => {
    // Simulates two interleaved writers racing on the same dashboard: this
    // call inserts panel "writer-b", but its first fenced write is lost
    // because a concurrent writer already saved a different panel
    // ("writer-a") in between. A correct retry re-reads that winning save and
    // reapplies "insert writer-b" on top of it, so both panels land instead
    // of the second writer clobbering the first's insert.
    const beforeConcurrentWrite = {
      kind: "sql",
      config: dashboardConfig(),
    };
    const afterConcurrentWrite = {
      kind: "sql",
      config: {
        ...dashboardConfig(),
        panels: [...dashboardConfig().panels, panel("writer-a")],
      },
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

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      operations: [
        {
          op: "insertPanel",
          panel: panel("writer-b"),
          position: "bottom",
        },
      ],
    });

    expect(mutateCallCount).toBe(2);
    expect(result.saved).toBe(true);
    expect(result.panelOrder).toEqual(["a", "b", "c", "writer-a", "writer-b"]);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<{ id: string }>;
    };
    expect(saved.panels.map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
      "writer-a",
      "writer-b",
    ]);
  });
});
