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
  dryRunQuerySchema: vi.fn(),
  resolvePanel: vi.fn(),
  hasCollabState: vi.fn(async () => false),
  applyText: vi.fn(async () => undefined),
  seedFromText: vi.fn(async () => undefined),
}));

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
  dryRunQuerySchema: mocks.dryRunQuerySchema,
}));

// Verification runs agent-edited panels through the source resolver; the
// default result carries every column the specs' panels bind to.
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
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));

const PANEL_ROWS = {
  rows: [{ date: "2026-01-01", name: "a", value: 1, a: 1, b: 2 }],
  schema: ["date", "name", "value", "a", "b"].map((name) => ({
    name,
    type: "STRING",
  })),
};

// The real validator opens the local PGlite directory, which fails whenever
// another test worker holds it; time-scope binding is still checked for real.
vi.mock("../server/lib/first-party-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/first-party-analytics.js")
  >()),
  validateFirstPartyAnalyticsSqlForScope: vi.fn(async () => undefined),
}));

const { DASHBOARD_MUTATION_EXAMPLES } =
  await import("./dashboard-mutation-api");
const { default: mutateDashboard } = await import("./mutate-dashboard");
const { DASHBOARD_COLLAB_SYNC_TIMEOUT_MS } =
  await import("../server/lib/dashboard-collab-sync");

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
    mocks.dryRunQuerySchema.mockReset();
    mocks.dryRunQuerySchema.mockResolvedValue({ error: null });
    mocks.resolvePanel.mockReset();
    mocks.resolvePanel.mockResolvedValue(PANEL_ROWS);
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

  it("returns the SQL save proof when collab sync hangs", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });
    mocks.hasCollabState.mockImplementationOnce(
      () => new Promise<boolean>(() => {}),
    );

    try {
      const result: any = await mutateDashboard.run({
        dashboardId: "traffic",
        code: 'dashboard.panel("a").setTitle("Alpha");',
      });

      expect(result.saved).toBe(true);
      expect(result.changedPanelIds).toEqual(["a"]);
      expect(result.collabSync).toEqual({
        status: "queued",
        timeoutMs: DASHBOARD_COLLAB_SYNC_TIMEOUT_MS,
      });
      expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(DASHBOARD_COLLAB_SYNC_TIMEOUT_MS);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Dashboard collab sync timed out for traffic"),
      );
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("advertises structured operations first and bounds legacy code", () => {
    const parameters = mutateDashboard.tool.parameters as {
      properties: Record<string, { minLength?: number; maxLength?: number }>;
      required: string[];
    };

    expect(Object.keys(parameters.properties)).toEqual([
      "dashboardId",
      "operations",
      "code",
      "dryRun",
      "allowEmptyResult",
      "returnConfig",
    ]);
    expect(parameters.required).toEqual(["dashboardId"]);
    expect(parameters.properties.dashboardId.minLength).toBe(1);
    expect(parameters.properties.code.maxLength).toBe(12_000);
    expect(parameters.properties.operations).toBeDefined();
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

  it("allows a later operation to complete an inserted panel", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    const result: any = await mutateDashboard.run({
      dashboardId: "traffic",
      operations: [
        { op: "insertPanel", panel: { id: "new-section" } },
        {
          op: "updatePanel",
          panelId: "new-section",
          patch: {
            title: "New section",
            chartType: "section",
            width: 1,
            columns: 2,
          },
        },
      ],
    });

    expect(result.saved).toBe(true);
    const saved = mocks.upsertDashboard.mock.calls[0][2] as {
      panels: Array<Record<string, unknown>>;
    };
    expect(saved.panels.at(-1)).toMatchObject({
      id: "new-section",
      title: "New section",
      chartType: "section",
      width: 1,
      columns: 2,
    });
  });

  it("rejects an inserted panel that still has no width before saving", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: dashboardConfig(),
    });

    await expect(
      mutateDashboard.run({
        dashboardId: "traffic",
        operations: [
          {
            op: "insertPanel",
            panel: {
              id: "incomplete-section",
              title: "Incomplete section",
              chartType: "section",
            },
          },
        ],
      }),
    ).rejects.toThrow(
      /panel "incomplete-section" \("Incomplete section"\) width is missing; set width to an integer 1-6/,
    );

    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("rejects an insert panel without a usable id at the action boundary", async () => {
    await expect(
      mutateDashboard.run({
        dashboardId: "traffic",
        operations: [
          {
            op: "insertPanel",
            panel: { title: "Missing id" },
          },
        ],
      }),
    ).rejects.toThrow(/Invalid action parameters/);

    expect(mocks.getDashboard).not.toHaveBeenCalled();
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("requires numeric widths for structured panel inserts", () => {
    const base = {
      dashboardId: "traffic",
      operations: [
        {
          op: "insertPanel",
          panel: panel("new-panel"),
        },
      ],
    };

    expect(mutateDashboard.schema.parse(base).operations).toEqual(
      base.operations,
    );
    expect(() =>
      mutateDashboard.schema.parse({
        ...base,
        operations: [
          {
            ...base.operations[0],
            panel: { ...base.operations[0].panel, width: "1" },
          },
        ],
      }),
    ).toThrow(/expected number, received string/i);
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

  it("validates multiple BigQuery panels in parallel within one batch", async () => {
    vi.useFakeTimers();
    try {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: {
          ...dashboardConfig(),
          panels: [panel("a", "bigquery"), panel("b", "bigquery")],
        },
      });
      mocks.dryRunQuery.mockImplementation(
        async () =>
          await new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 100),
          ),
      );

      const pending = mutateDashboard.run({
        dashboardId: "traffic",
        operations: [
          {
            op: "updatePanel",
            panelId: "a",
            patch: { sql: "SELECT 1" },
          },
          {
            op: "updatePanel",
            panelId: "b",
            patch: { sql: "SELECT 2" },
          },
        ],
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(mocks.dryRunQuery).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ saved: true });
    } finally {
      vi.useRealTimers();
    }
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
        await mutate(beforeConcurrentWrite);
        mutateCallCount += 1;
        const { kind, body } = await mutate(afterConcurrentWrite);
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

  describe("render contract", () => {
    const agent = { caller: "tool" } as never;

    function lineConfig(extra: Record<string, unknown> = {}) {
      return {
        ...dashboardConfig(),
        panels: [
          { ...panel("a"), chartType: "line", ...extra },
          panel("b"),
          panel("c"),
        ],
      };
    }

    it("rejects a config key the renderer ignores, with did-you-mean, and writes nothing", async () => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: lineConfig(),
      });

      const attempt = mutateDashboard.run(
        {
          dashboardId: "traffic",
          operations: [
            {
              op: "updatePanel",
              panelId: "a",
              patch: { config: { yAxis: { format: "percent" } } },
            },
          ],
        },
        agent,
      );

      await expect(attempt).rejects.toMatchObject({
        errorCode: "invalid_panel_config",
        message: expect.stringContaining("Did you mean 'yFormatter'?"),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("rejects renderer options placed at the panel level", async () => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: lineConfig(),
      });

      await expect(
        mutateDashboard.run(
          {
            dashboardId: "traffic",
            operations: [
              { op: "updatePanel", panelId: "a", patch: { yKeys: ["x"] } },
            ],
          },
          agent,
        ),
      ).rejects.toThrow(/"yKeys" at the panel level.*config\.yKeys/);
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("leaves UI callers unchanged", async () => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: lineConfig(),
      });

      const result: any = await mutateDashboard.run({
        dashboardId: "traffic",
        operations: [
          {
            op: "updatePanel",
            panelId: "a",
            patch: { config: { yAxis: { format: "percent" } } },
          },
        ],
      });

      expect(result.saved).toBe(true);
      expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    });

    it("accepts a combo chart insert with valid renderer options", async () => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: dashboardConfig(),
      });
      const insertPanel = {
        ...panel("combo"),
        chartType: "combo",
        config: { yKeys: ["a", "b"], barKeys: ["a"] },
      };

      expect(() =>
        mutateDashboard.schema.parse({
          dashboardId: "traffic",
          operations: [{ op: "insertPanel", panel: insertPanel }],
        }),
      ).not.toThrow();
      const result: any = await mutateDashboard.run(
        {
          dashboardId: "traffic",
          operations: [{ op: "insertPanel", panel: insertPanel }],
        },
        agent,
      );

      expect(result.insertedPanelIds).toEqual(["combo"]);
    });

    it.each(["a", "b"])(
      "never blocks editing panel %s over a legacy stray key it did not change",
      async (panelId) => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: lineConfig({ config: { yAxis: { format: "percent" } } }),
        });

        const result: any = await mutateDashboard.run(
          {
            dashboardId: "traffic",
            operations: [
              { op: "updatePanel", panelId, patch: { title: "Renamed" } },
            ],
          },
          agent,
        );

        expect(result.changedPanelIds).toEqual([panelId]);
        expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
      },
    );

    it.each(DASHBOARD_MUTATION_EXAMPLES)(
      "documents an example that passes agent validation: %s",
      async (example) => {
        const timeRange = {
          id: "timeRange",
          type: "select",
          label: "Time range",
          default: "30d",
          options: ["7d", "30d", "90d"].map((value) => ({
            value,
            label: value,
          })),
        };
        const emailFilter = {
          id: "emailFilter",
          type: "select",
          label: "Email filter",
          default: "all",
          options: [
            { value: "all", label: "All users" },
            { value: "exclude_builder", label: "Exclude @builder.io" },
          ],
        };
        const examplePanel = (id: string, title: string) => ({
          ...panel(id),
          title,
        });
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: {
            name: "Examples",
            columns: 2,
            filters: [timeRange, emailFilter],
            panels: [
              examplePanel("retention", "Retention"),
              examplePanel("top-referrers", "Top Referrers"),
              examplePanel("recurring-users-by-template", "Recurring Users"),
              examplePanel("dau-over-time", "Signed-In Daily Active Visitors"),
              examplePanel("wau-over-time", "Signed-In Weekly Active Visitors"),
              examplePanel("retention-over-time", "Retention Over Time"),
              {
                id: "retention-activity-section",
                title: "Retention activity",
                chartType: "section",
                width: 1,
                columns: 2,
              },
              examplePanel("repeat-users", "Repeat Users"),
            ],
          },
        });

        const result: any = await mutateDashboard.run(
          { dashboardId: "traffic", code: example, dryRun: true },
          agent,
        );

        expect(result).toMatchObject({ dryRun: true, noop: false });
        expect(
          result.changedPanelIds.length + result.dashboardFieldsChanged.length,
        ).toBeGreaterThan(0);
      },
    );

    describe("legacy structure", () => {
      const legacyConfig = () => ({
        ...dashboardConfig(),
        panels: [
          panel("a"),
          panel("b"),
          { ...panel("viral-by-app"), title: "VIRALITY BY APP", width: "wide" },
        ],
      });

      it.each([
        ["agent", agent],
        ["UI", undefined],
      ])(
        "lets a %s edit an unrelated panel and saves the legacy one as-is",
        async (_name, ctx) => {
          mocks.getDashboard.mockResolvedValue({
            kind: "sql",
            config: legacyConfig(),
          });

          const result: any = await mutateDashboard.run(
            {
              dashboardId: "traffic",
              operations: [
                {
                  op: "updatePanel",
                  panelId: "a",
                  patch: { title: "Renamed" },
                },
              ],
            },
            ctx as never,
          );

          expect(result.saved).toBe(true);
          expect(result.changedPanelIds).toEqual(["a"]);
          const saved = mocks.upsertDashboard.mock.calls[0][2] as {
            panels: Array<{ id: string; width: unknown }>;
          };
          expect(saved.panels[2].width).toBe("wide");
        },
      );

      it("rejects an edit that breaks a valid panel and names every offender", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: legacyConfig(),
        });

        const attempt = mutateDashboard.run(
          {
            dashboardId: "traffic",
            operations: [
              { op: "updatePanel", panelId: "a", patch: { width: 0 } },
              { op: "updatePanel", panelId: "b", patch: { width: 9 } },
            ],
          },
          agent,
        );

        await expect(attempt).rejects.toMatchObject({
          errorCode: "dashboard_invalid_panel",
          message:
            'panel "a" ("a") width is 0; set width to an integer 1-6 (updatePanel patch {"width":1}).\n' +
            'panel "b" ("b") width is 9; set width to an integer 1-6 (updatePanel patch {"width":1}).',
        });
        expect(mocks.upsertDashboard).not.toHaveBeenCalled();
      });

      it("makes a touched legacy panel repairable by name", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: legacyConfig(),
        });

        await expect(
          mutateDashboard.run(
            {
              dashboardId: "traffic",
              operations: [
                {
                  op: "updatePanel",
                  panelId: "viral-by-app",
                  patch: { title: "VIRALITY" },
                },
              ],
            },
            agent,
          ),
        ).rejects.toThrow(
          /panel "viral-by-app" \("VIRALITY"\) width is "wide"; set width to an integer 1-6/,
        );

        const repaired: any = await mutateDashboard.run(
          {
            dashboardId: "traffic",
            operations: [
              {
                op: "updatePanel",
                panelId: "viral-by-app",
                patch: { width: 1 },
              },
            ],
          },
          agent,
        );
        expect(repaired.saved).toBe(true);
      });
    });

    describe("no-op detection", () => {
      const identicalPatch = {
        dashboardId: "traffic",
        operations: [
          {
            op: "updatePanel" as const,
            panelId: "a",
            patch: { title: "a", width: 1 },
          },
        ],
      };

      it("fails an agent call that changes nothing instead of reporting it saved", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: dashboardConfig(),
        });

        const attempt = mutateDashboard.run(identicalPatch, agent);

        await expect(attempt).rejects.toMatchObject({
          errorCode: "no_effective_change",
          message: expect.stringContaining("inspect-dashboard-panel"),
        });
        await expect(attempt).rejects.toThrow(/ops that changed nothing: 1/);
        expect(mocks.upsertDashboard).not.toHaveBeenCalled();
        expect(mocks.applyText).not.toHaveBeenCalled();
      });

      it("returns a distinguishable no-op to UI callers without writing", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: dashboardConfig(),
        });

        const result: any = await mutateDashboard.run(identicalPatch);

        expect(result).toMatchObject({
          saved: false,
          changed: false,
          noop: true,
          changedPanelIds: [],
          noopOps: [1],
          collabSync: { status: "skipped" },
        });
        expect(result.summary).toContain("nothing was written");
        expect(mocks.upsertDashboard).not.toHaveBeenCalled();
      });

      it("reports a dry run of a no-op as a no-op without failing", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: dashboardConfig(),
        });

        const result: any = await mutateDashboard.run(
          { ...identicalPatch, dryRun: true },
          agent,
        );

        expect(result).toMatchObject({
          dryRun: true,
          saved: false,
          changed: false,
          noop: true,
        });
      });

      it("skips SQL validation for a same-SQL patch", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: { ...dashboardConfig(), panels: [panel("a", "bigquery")] },
        });

        const result: any = await mutateDashboard.run({
          dashboardId: "traffic",
          operations: [
            {
              op: "updatePanel",
              panelId: "a",
              patch: {
                sql: "SELECT COUNT(*) AS value FROM `project.dataset.table`",
              },
            },
          ],
        });

        expect(result.noop).toBe(true);
        expect(mocks.dryRunQuery).not.toHaveBeenCalled();
      });

      it("counts a default filter that is already set as no change", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: {
            ...dashboardConfig(),
            filters: [
              {
                id: "emailFilter",
                type: "select",
                default: "all",
                options: [{ value: "all", label: "All" }],
              },
            ],
          },
        });

        const result: any = await mutateDashboard.run({
          dashboardId: "traffic",
          code: 'dashboard.setFilterDefault("emailFilter","all");',
        });

        expect(result).toMatchObject({ saved: false, noop: true });
        expect(result.dashboardFieldsChanged).toEqual([]);
      });

      it("saves a mixed batch and reports only the panels that changed", async () => {
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: dashboardConfig(),
        });

        const result: any = await mutateDashboard.run(
          {
            dashboardId: "traffic",
            operations: [
              { op: "updatePanel", panelId: "a", patch: { title: "Alpha" } },
              { op: "updatePanel", panelId: "b", patch: { title: "b" } },
            ],
          },
          agent,
        );

        expect(result).toMatchObject({
          saved: true,
          changed: true,
          noop: false,
          changedPanelIds: ["a"],
          noopOps: [2],
        });
        expect(result.commandLog).toEqual([
          "updatePanel(a: title)",
          "updatePanel(b: no change)",
        ]);
        expect(result.summary).toContain("Ops that changed nothing: 2.");
        expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
      });
    });
  });
  describe("verified writes", () => {
    const agent = { caller: "tool" } as never;
    const timeRange = {
      id: "timeRange",
      type: "select",
      label: "Range",
      default: "30d",
      options: ["7d", "30d"].map((value) => ({ value, label: value })),
    };
    const LONG_ROWS = [
      { week: "2026-09-01", app: "mail", n: 10, n_4wk_avg: 9 },
      { week: "2026-09-01", app: "clips", n: 20, n_4wk_avg: 19 },
      { week: "2026-09-08", app: "mail", n: 11, n_4wk_avg: 10 },
    ];
    const WIDE_ROWS = [
      { week: "2026-09-01", mail: 10, clips: 20, mail_4wk_avg: 9 },
      { week: "2026-09-08", mail: 11, clips: 21, mail_4wk_avg: 10 },
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

    function pivotPanel(id = "signups-by-app") {
      return {
        id,
        title: "Signups by app",
        source: "bigquery",
        chartType: "line",
        width: 2,
        sql: "SELECT week, app, n FROM t WHERE r = '{{timeRange}}'",
        config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } },
      };
    }

    function verifiedDashboard(extraPanels: unknown[] = []) {
      return {
        name: "Growth",
        columns: 2,
        filters: [timeRange],
        panels: [pivotPanel(), ...extraPanels],
      };
    }

    function updatePanel(panelId: string, patch: Record<string, unknown>) {
      return {
        dashboardId: "growth",
        operations: [{ op: "updatePanel", panelId, patch }],
      };
    }

    beforeEach(() => {
      mocks.getDashboard.mockResolvedValue({
        kind: "sql",
        config: verifiedDashboard([panel("kpi", "first-party")]),
      });
      mocks.resolvePanel.mockResolvedValue(result(LONG_ROWS));
    });

    it("refuses to add a rolling-average column under a pivot that would drop it (report 1)", async () => {
      const attempt = mutateDashboard.run(
        updatePanel("signups-by-app", {
          sql: "SELECT week, app, n, n_4wk_avg FROM t WHERE r = '{{timeRange}}'",
          config: {
            yKeys: ["n", "n_4wk_avg"],
            pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
          },
        }),
        agent,
      );

      await expect(attempt).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
        message: expect.stringMatching(
          /panel "signups-by-app" \("Signups by app"\).*config\.yKeys ignored.*Remove config\.pivot/s,
        ),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("refuses a rewritten wide query that blanks a pivoted panel and writes nothing (report 2)", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      const attempt = mutateDashboard.run(
        updatePanel("signups-by-app", {
          sql: "SELECT week, mail, clips, mail_4wk_avg FROM t WHERE r = '{{timeRange}}'",
        }),
        agent,
      );

      await expect(attempt).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
        statusCode: 422,
        message: expect.stringContaining("week, mail, clips, mail_4wk_avg"),
      });
      await expect(attempt).rejects.toThrow(/Remove config\.pivot/);
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("saves a panel that renders and returns the proof", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      const saved: any = await mutateDashboard.run(
        updatePanel("signups-by-app", {
          sql: "SELECT week, mail, clips, mail_4wk_avg FROM t WHERE r = '{{timeRange}}'",
          config: {
            pivot: null,
            yKeys: ["mail", "clips", "mail_4wk_avg"],
          },
        }),
        agent,
      );

      expect(saved).toMatchObject({ saved: true, verified: true });
      expect(saved.verification).toEqual([
        expect.objectContaining({
          panelId: "signups-by-app",
          status: "ok",
          rowCount: 2,
          columns: ["week", "mail", "clips", "mail_4wk_avg"],
          missingKeys: [],
        }),
      ]);
      expect(saved.summary).toContain("Verified: Signups by app -> 2 rows");
      expect(saved.nextStep).toBeUndefined();
      expect(mocks.upsertDashboard).toHaveBeenCalledOnce();
    });

    it("refuses a panel that returns no rows unless allowEmptyResult is set, then saves it unverified", async () => {
      mocks.resolvePanel.mockResolvedValue({
        rows: [],
        schema: [
          { name: "week", type: "DATE" },
          { name: "app", type: "STRING" },
          { name: "n", type: "INT64" },
        ],
      });
      const edit = updatePanel("signups-by-app", {
        sql: "SELECT week, app, n FROM t WHERE r = '{{timeRange}}' AND n > 1e9",
      });

      await expect(mutateDashboard.run(edit, agent)).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
        message: expect.stringContaining('the viewer sees "No data"'),
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();

      const saved: any = await mutateDashboard.run(
        { ...edit, allowEmptyResult: true },
        agent,
      );

      expect(saved).toMatchObject({ saved: true, verified: false });
      expect(saved.unverified).toEqual([
        expect.objectContaining({
          panelId: "signups-by-app",
          status: "empty",
        }),
      ]);
      expect(saved.nextStep).toMatch(/^REQUIRED: call inspect-dashboard-panel/);
      expect(saved.summary).toMatch(/^SAVED BUT NOT VERIFIED:/);
    });

    it("never lets allowEmptyResult save a stale pivot", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      await expect(
        mutateDashboard.run(
          {
            ...updatePanel("signups-by-app", {
              sql: "SELECT week, mail, clips FROM t WHERE r = '{{timeRange}}'",
            }),
            allowEmptyResult: true,
          },
          agent,
        ),
      ).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("saves with verified:false and a required next step when a panel cannot be checked", async () => {
      mocks.resolvePanel.mockResolvedValue({
        error: "missing_api_key",
        message: "Connect BigQuery",
      });

      const saved: any = await mutateDashboard.run(
        updatePanel("signups-by-app", { config: { yKeys: ["n"] } }),
        agent,
      );

      expect(saved).toMatchObject({ saved: true, verified: false });
      expect(saved.unverified).toEqual([
        expect.objectContaining({ note: "missing_credential" }),
      ]);
      expect(saved.nextStep).toContain("inspect-dashboard-panel");
      expect(saved.message).toMatch(/^SAVED BUT NOT VERIFIED:/);
    });

    it("executes nothing for a title, width or layout edit", async () => {
      const saved: any = await mutateDashboard.run(
        {
          dashboardId: "growth",
          operations: [
            {
              op: "updatePanel",
              panelId: "signups-by-app",
              patch: { title: "Renamed", width: 3 },
            },
            { op: "movePanels", panelIds: ["kpi"], position: "top" },
          ],
        },
        agent,
      );

      expect(saved).toMatchObject({ saved: true, verified: null });
      expect(mocks.resolvePanel).not.toHaveBeenCalled();
      expect(mocks.dryRunQuerySchema).not.toHaveBeenCalled();
    });

    it("runs the same verification on a dry run and still writes nothing", async () => {
      const ok: any = await mutateDashboard.run(
        {
          ...updatePanel("signups-by-app", {
            sql: "SELECT week, app, n FROM t WHERE r = '{{timeRange}}' LIMIT 50",
          }),
          dryRun: true,
        },
        agent,
      );
      expect(ok).toMatchObject({ saved: false, dryRun: true, verified: true });

      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));
      await expect(
        mutateDashboard.run(
          {
            ...updatePanel("signups-by-app", {
              sql: "SELECT week, mail FROM t WHERE r = '{{timeRange}}'",
            }),
            dryRun: true,
          },
          agent,
        ),
      ).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
      });
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    });

    it("does not re-run a panel when the save retries after a concurrent write", async () => {
      const existing = { kind: "sql", config: verifiedDashboard() };
      mocks.upsertDashboardWithRetry.mockImplementation(
        async (id: string, ctx: unknown, mutate: any) => {
          await mutate(existing);
          const { kind, body } = await mutate(existing);
          await mocks.upsertDashboard(id, kind, body, ctx);
          return { ...existing, kind, config: body };
        },
      );

      const saved: any = await mutateDashboard.run(
        updatePanel("signups-by-app", {
          sql: "SELECT week, app, n FROM t WHERE r = '{{timeRange}}' LIMIT 9",
        }),
        agent,
      );

      expect(saved.saved).toBe(true);
      expect(mocks.resolvePanel).toHaveBeenCalledTimes(1);
    });

    it("leaves UI callers on today's behavior: no verification, nothing blocked", async () => {
      mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

      const saved: any = await mutateDashboard.run(
        updatePanel("signups-by-app", {
          sql: "SELECT week, mail FROM t WHERE r = '{{timeRange}}'",
        }),
      );

      expect(saved.saved).toBe(true);
      expect(saved.verified).toBeUndefined();
      expect(mocks.resolvePanel).not.toHaveBeenCalled();
    });

    it("verifies panels affected by a filter-default change without blocking the edit", async () => {
      mocks.resolvePanel.mockResolvedValue({
        rows: [],
        schema: [
          { name: "week", type: "DATE" },
          { name: "app", type: "STRING" },
          { name: "n", type: "INT64" },
        ],
      });

      const saved: any = await mutateDashboard.run(
        {
          dashboardId: "growth",
          operations: [
            { op: "setFilterDefault", filterId: "timeRange", value: "7d" },
          ],
        },
        agent,
      );

      expect(saved).toMatchObject({ saved: true, verified: false });
      expect(saved.unverified[0]).toMatchObject({
        panelId: "signups-by-app",
        status: "empty",
      });
    });

    describe("write receipt", () => {
      it("says verified:true and names the panel when the edit renders", async () => {
        mocks.resolvePanel.mockResolvedValue(result(WIDE_ROWS));

        const saved: any = await mutateDashboard.run(
          updatePanel("signups-by-app", {
            sql: "SELECT week, mail, clips FROM t WHERE r = '{{timeRange}}'",
            config: { pivot: null, yKeys: ["mail", "clips"] },
          }),
          agent,
        );

        expect(saved._receipt).toMatchObject({
          changed: true,
          verified: true,
          summary: expect.stringContaining('"Signups by app"'),
          checks: [{ id: "signups-by-app", ok: true }],
        });
      });

      it("says verified:false with the failing panel and reason when a panel cannot be checked", async () => {
        mocks.resolvePanel.mockResolvedValue({
          error: "missing_api_key",
          message: "Connect BigQuery",
        });

        const saved: any = await mutateDashboard.run(
          updatePanel("signups-by-app", { config: { yKeys: ["n"] } }),
          agent,
        );

        expect(saved._receipt).toMatchObject({
          changed: true,
          verified: false,
          summary: expect.stringMatching(
            /NOT verified: "Signups by app" .*not connected/,
          ),
          checks: [
            {
              id: "signups-by-app",
              ok: false,
              detail: expect.stringContaining("not connected"),
            },
          ],
        });
        expect(saved._receipt.summary.length).toBeLessThanOrEqual(200);
      });

      it("lists failing checks first so the check cap never drops the reason", async () => {
        mocks.resolvePanel.mockImplementation(async (args: any) =>
          String(args?.query ?? args?.sql ?? "").includes("-- 3")
            ? { error: "missing_api_key", message: "Connect BigQuery" }
            : result(LONG_ROWS),
        );
        mocks.getDashboard.mockResolvedValue({
          kind: "sql",
          config: verifiedDashboard(
            Array.from({ length: 4 }, (_, i) => ({
              ...pivotPanel(`extra-${i}`),
              sql: `SELECT week, app, n FROM t WHERE r = '{{timeRange}}' -- ${i}`,
            })),
          ),
        });

        const saved: any = await mutateDashboard.run(
          {
            dashboardId: "growth",
            operations: [
              { op: "setFilterDefault", filterId: "timeRange", value: "7d" },
            ],
          },
          agent,
        );

        const oks = saved._receipt.checks.map((check: any) => check.ok);
        expect(oks).toContain(false);
        expect(oks).toEqual([...oks].sort((a, b) => Number(a) - Number(b)));
      });

      it("says verified:true with no render check for a title or layout edit", async () => {
        const saved: any = await mutateDashboard.run(
          updatePanel("signups-by-app", { title: "Renamed" }),
          agent,
        );

        expect(saved._receipt).toEqual({
          changed: true,
          verified: true,
          summary: expect.stringContaining("no panel render was affected"),
        });
      });

      it("emits no receipt for a dry run, which writes nothing, or for a UI caller", async () => {
        const dry: any = await mutateDashboard.run(
          {
            ...updatePanel("signups-by-app", {
              sql: "SELECT week, app, n FROM t WHERE r = '{{timeRange}}' LIMIT 50",
            }),
            dryRun: true,
          },
          agent,
        );
        expect(dry._receipt).toBeUndefined();

        const ui: any = await mutateDashboard.run(
          updatePanel("signups-by-app", { title: "Renamed" }),
        );
        expect(ui._receipt).toBeUndefined();
      });
    });
  });
});
