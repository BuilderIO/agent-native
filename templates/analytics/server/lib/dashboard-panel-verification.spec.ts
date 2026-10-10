import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFilterVars } from "../../app/pages/adhoc/sql-dashboard/filter-vars";
import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "../../app/pages/adhoc/sql-dashboard/panel-sql";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  dryRun: vi.fn(),
  credentials: vi.fn(),
  planFailure: { current: null as Error | null },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: mocks.credentials,
}));
vi.mock("./dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolve,
}));
vi.mock("./bigquery", () => ({ dryRunQuerySchema: mocks.dryRun }));
vi.mock("../../shared/panel-render-contract", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../shared/panel-render-contract")>();
  return {
    ...actual,
    planPanelRender: (...args: Parameters<typeof actual.planPanelRender>) => {
      if (mocks.planFailure.current) throw mocks.planFailure.current;
      return actual.planPanelRender(...args);
    },
  };
});

const {
  annotateSummary,
  describePanelOutcome,
  formatVerificationFailure,
  isAgentCaller,
  pageDashboardConfig,
  resolveVerificationVars,
  touchedPanelIds,
  touchedVisualPanels,
  verdictFields,
  verifyDashboardPanels,
  verifyPanelWrite,
} = await import("./dashboard-panel-verification");

const TIME_RANGE_FILTER = {
  id: "timeRange",
  label: "Range",
  type: "select",
  default: "30d",
  options: [
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "all", label: "All" },
  ],
};

function panel(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    title: "Signups",
    source: "bigquery",
    chartType: "line",
    width: 2,
    sql: "SELECT week, signups FROM t WHERE range = '{{timeRange}}'",
    ...overrides,
  };
}

function dashboard(
  panels: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return { name: "T", filters: [TIME_RANGE_FILTER], panels, ...extra };
}

function rows(
  data: Record<string, unknown>[],
  schema?: { name: string; type: string }[],
) {
  return {
    rows: data,
    schema:
      schema ??
      Object.keys(data[0] ?? {}).map((name) => ({ name, type: "STRING" })),
  };
}

const WIDE = [
  { week: "2026-09-01", signups: 10, signups_4wk_avg: 9 },
  { week: "2026-09-08", signups: 12, signups_4wk_avg: 10 },
];
const LONG = [
  { week: "2026-09-01", app: "a", n: 10, avg: 9 },
  { week: "2026-09-01", app: "b", n: 20, avg: 19 },
  { week: "2026-09-08", app: "a", n: 11, avg: 10 },
];

beforeEach(() => {
  mocks.planFailure.current = null;
  mocks.resolve.mockReset();
  mocks.dryRun.mockReset();
  mocks.dryRun.mockResolvedValue({ error: null });
  mocks.credentials.mockReset();
  mocks.credentials.mockReturnValue({
    userEmail: "alice@example.com",
    orgId: null,
  });
});

describe("resolveVerificationVars", () => {
  const config = {
    variables: { team: "growth", mode: "variable-default" },
    filters: [
      TIME_RANGE_FILTER,
      { id: "mode", label: "Mode", type: "toggle", default: "on" },
      { id: "app", label: "App", type: "select", default: "mail" },
    ],
  };

  it("matches the browser's merge of variables under filter values", () => {
    const browser = {
      ...config.variables,
      ...resolveFilterVars(config.filters as never, () => ""),
    };

    expect(resolveVerificationVars(config)).toEqual(browser);
    // The old dry-run resolver let the variable win over the filter and gave a
    // toggle its default; the page does neither.
    expect(resolveVerificationVars(config).mode).toBe("");
    expect(resolveVerificationVars(config).app).toBe("mail");
  });

  it("applies URL-style filter overrides with or without the f_ prefix", () => {
    const params = new URLSearchParams({ f_timeRange: "7d", f_app: "clips" });
    const browser = {
      ...config.variables,
      ...resolveFilterVars(
        config.filters as never,
        (key) => params.get(`f_${key}`) ?? "",
      ),
    };

    expect(
      resolveVerificationVars(config, { timeRange: "7d", f_app: "clips" }),
    ).toEqual(browser);
  });
});

describe("verifyDashboardPanels", () => {
  it("runs the exact SQL the browser sends for the page's variable state", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const variables = { mode: "x" };
    const config = dashboard([panel()], {
      variables,
      filters: [TIME_RANGE_FILTER],
    });

    await verifyDashboardPanels(config, ["p1"], {
      filters: { timeRange: "7d" },
    });

    const params = new URLSearchParams({ f_timeRange: "7d" });
    const browserVars = {
      ...variables,
      ...resolveFilterVars(
        config.filters as never,
        (key) => params.get(`f_${key}`) ?? "",
      ),
    };
    const [request, context] = mocks.resolve.mock.calls[0];
    expect(request.query).toBe(
      interpolateDashboardPanelSql(
        serializePanelSql(config.panels[0].sql),
        browserVars,
        config.panels[0],
      ),
    );
    expect(request.source).toBe("bigquery");
    expect(context).toEqual({ userEmail: "alice@example.com", orgId: null });
  });

  it("reports ok with columns, counts, bounded sample rows and resolved filters", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      week: `w${i}`,
      signups: i,
      note: "x".repeat(200),
    }));
    mocks.resolve.mockResolvedValue(rows(many));

    const result = await verifyDashboardPanels(dashboard([panel()]), ["p1"], {
      sampleRows: 99,
    });

    const [verified] = result.panels;
    expect(result).toMatchObject({ verified: true, blocking: false });
    expect(verified).toMatchObject({
      status: "ok",
      rowCount: 40,
      renderedRowCount: 40,
      columns: ["week", "signups", "note"],
      resolvedFilters: { timeRange: "30d" },
    });
    expect(verified.sample).toHaveLength(20);
    expect((verified.sample![0].note as string).length).toBeLessThan(100);
    expect(verified.resolvedSql).toContain("range = '30d'");
  });

  it("reports zero rows as empty, never ok", async () => {
    mocks.resolve.mockResolvedValue(rows([], [{ name: "week", type: "DATE" }]));

    const result = await verifyDashboardPanels(dashboard([panel()]), ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "empty",
      rowCount: 0,
      renderedRowCount: 0,
    });
    expect(result).toMatchObject({ verified: false, blocking: true });
  });

  it("treats a zero-row result whose schema cannot bind the config as missing columns, not as empty", async () => {
    mocks.resolve.mockResolvedValue(rows([], [{ name: "week", type: "DATE" }]));
    const config = dashboard([
      panel({ config: { yKeys: ["signups", "rolling"] } }),
    ]);

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "missing-columns",
      missingKeys: ["signups", "rolling"],
    });
  });

  it("refuses a stale pivot over wide-format rows and says how to fix it", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const config = dashboard([
      panel({
        config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } },
      }),
    ]);

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "missing-columns",
      rowCount: 2,
      renderedRowCount: 0,
      missingKeys: ["app", "n"],
    });
    expect(result.panels[0].hint).toContain("Remove config.pivot");
    expect(result.panels[0].hint).toContain("signups, signups_4wk_avg");
  });

  it("flags a column that config.pivot would silently drop", async () => {
    mocks.resolve.mockResolvedValue(rows(LONG));
    const config = dashboard([
      panel({
        config: {
          yKeys: ["n", "avg"],
          pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
        },
      }),
    ]);

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0].status).toBe("missing-columns");
    expect(result.panels[0].ignoredConfig).toEqual([
      expect.objectContaining({
        key: "yKeys",
        reason: expect.stringContaining("Remove config.pivot"),
      }),
    ]);
  });

  it("does not treat config.yKey beside config.pivot as an ignored series request", async () => {
    mocks.resolve.mockResolvedValue(rows(LONG));
    const config = dashboard([
      panel({
        config: {
          yKey: "n",
          pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
        },
      }),
    ]);

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "ok",
      ignoredConfig: [],
    });
  });

  it("maps a source error result and a thrown error to query-error", async () => {
    mocks.resolve
      .mockResolvedValueOnce({ error: "bad_query", message: "Syntax error" })
      .mockRejectedValueOnce(new Error("connection reset"));
    const config = dashboard([panel(), panel({ id: "p2" })]);

    const result = await verifyDashboardPanels(config, ["p1", "p2"]);

    expect(result.panels.map((p) => [p.status, p.error])).toEqual([
      ["query-error", "Syntax error"],
      ["query-error", "connection reset"],
    ]);
    expect(result.blocking).toBe(true);
  });

  it("reports a missing credential as unverified, not ok and not a failure", async () => {
    mocks.resolve.mockResolvedValue({
      error: "missing_api_key",
      message: "Connect BigQuery",
    });

    const result = await verifyDashboardPanels(dashboard([panel()]), ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "unverified",
      note: "missing_credential",
      error: "Connect BigQuery",
    });
    expect(result).toMatchObject({ verified: false, blocking: false });
  });

  it("marks a panel that outlives the budget unverified(timeout) and aborts its query", async () => {
    let seenSignal: AbortSignal | undefined;
    mocks.resolve.mockImplementation(
      (request: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          seenSignal = request.signal;
          request.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    const result = await verifyDashboardPanels(dashboard([panel()]), ["p1"], {
      budgetMs: 30,
    });

    expect(result.panels[0]).toMatchObject({
      status: "unverified",
      note: "timeout",
    });
    expect(result.blocking).toBe(false);
    expect(seenSignal?.aborted).toBe(true);
  });

  it("throws when the caller's signal aborts instead of reporting a verdict", async () => {
    const controller = new AbortController();
    mocks.resolve.mockImplementation(
      (request: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          controller.abort();
        }),
    );

    await expect(
      verifyDashboardPanels(dashboard([panel()]), ["p1"], {
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
  });

  it("reports an unresolvable time variable without running the panel", async () => {
    const config = {
      name: "T",
      filters: [],
      panels: [panel({ source: "first-party" })],
    };

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0]).toMatchObject({ status: "query-error" });
    expect(result.panels[0].error).toContain("{{timeRange}}");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("never runs a data-program panel", async () => {
    const config = dashboard([
      panel({ source: "program", sql: '{"programId":"dp_abc"}' }),
    ]);

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "unverified",
      note: "skipped:program",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("executes at most maxExecuted panels and leaves the rest unverified", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const panels = Array.from({ length: 8 }, (_, i) => panel({ id: `p${i}` }));

    const result = await verifyDashboardPanels(
      dashboard(panels),
      panels.map((p) => p.id),
      { maxExecuted: 3 },
    );

    expect(mocks.resolve).toHaveBeenCalledTimes(3);
    expect(result.panels.filter((p) => p.status === "ok")).toHaveLength(3);
    expect(
      result.panels.filter((p) => p.note === "not_executed:over_budget"),
    ).toHaveLength(5);
    expect(result.verified).toBe(false);
  });

  it("caps concurrency: one first-party query at a time, four otherwise", async () => {
    let active = 0;
    let peak = 0;
    mocks.resolve.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return rows(WIDE);
    });
    const firstParty = Array.from({ length: 4 }, (_, i) =>
      panel({ id: `f${i}`, source: "first-party" }),
    );

    await verifyDashboardPanels(
      dashboard(firstParty),
      firstParty.map((p) => p.id),
    );
    expect(peak).toBe(1);

    peak = 0;
    const bigQuery = Array.from({ length: 6 }, (_, i) =>
      panel({ id: `b${i}` }),
    );
    await verifyDashboardPanels(
      dashboard(bigQuery),
      bigQuery.map((p) => p.id),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("uses the BigQuery dry run to fail early and to skip an oversized scan", async () => {
    mocks.dryRun
      .mockResolvedValueOnce({ error: "Unrecognized name: nope" })
      .mockResolvedValueOnce({
        error: null,
        schema: [{ name: "week", type: "DATE" }],
      })
      .mockResolvedValueOnce({ error: null, totalBytesProcessed: 90e9 })
      .mockResolvedValueOnce({ error: "validation timed out", timedOut: true });
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const config = dashboard([
      panel({ id: "bad" }),
      panel({ id: "unbound", config: { yKeys: ["signups"] } }),
      panel({ id: "huge" }),
      panel({ id: "slow-dry-run" }),
    ]);

    const result = await verifyDashboardPanels(config, [
      "bad",
      "unbound",
      "huge",
      "slow-dry-run",
    ]);

    expect(result.panels.map((p) => [p.panelId, p.status, p.note])).toEqual([
      ["bad", "query-error", undefined],
      ["unbound", "missing-columns", undefined],
      ["huge", "unverified", "too_expensive"],
      ["slow-dry-run", "ok", undefined],
    ]);
    // Only the panel whose dry run timed out went on to execute.
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("reuses a memoized result instead of re-running the panel", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const memo = new Map();

    await verifyDashboardPanels(dashboard([panel()]), ["p1"], { memo });
    await verifyDashboardPanels(dashboard([panel()]), ["p1"], { memo });

    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("flags config keys the renderer ignores, but only when they changed against the base", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const legacy = panel({ config: { rollingAvg: 4 } });
    const config = dashboard([legacy]);

    const unchanged = await verifyDashboardPanels(config, ["p1"], {
      base: config,
    });
    const fresh = await verifyDashboardPanels(config, ["p1"]);

    expect(unchanged.panels[0].staticIssues).toEqual([]);
    expect(fresh.panels[0].staticIssues).toHaveLength(1);
    expect(fresh.blocking).toBe(true);
  });

  describe("server-authored panels", () => {
    const catalogBar = panel({
      chartType: "bar",
      config: { xKey: "week", yKey: "signups", color: "#10b981" },
    });
    const serverAuthoredPanelIds = new Set(["p1"]);

    it("skips the config-key rules for them and still verifies the render", async () => {
      mocks.resolve.mockResolvedValue(rows(WIDE));
      const config = dashboard([catalogBar]);

      const agentAuthored = await verifyDashboardPanels(config, ["p1"]);
      const serverAuthored = await verifyDashboardPanels(config, ["p1"], {
        serverAuthoredPanelIds,
      });

      expect(agentAuthored.panels[0].staticIssues).toEqual([
        expect.objectContaining({ kind: "wrong-chart-type", key: "color" }),
      ]);
      expect(serverAuthored.panels[0]).toMatchObject({
        status: "ok",
        staticIssues: [],
      });
      expect(serverAuthored.verified).toBe(true);

      mocks.resolve.mockResolvedValue(rows([{ week: "2026-09-01", n: 1 }]));
      const unbound = await verifyDashboardPanels(config, ["p1"], {
        serverAuthoredPanelIds,
      });
      expect(unbound.panels[0].status).toBe("missing-columns");
      expect(unbound.blocking).toBe(true);
    });

    it("keeps the chart type and the id, which come from the agent's request", async () => {
      mocks.resolve.mockResolvedValue(rows(WIDE));

      const misspelled = await verifyDashboardPanels(
        dashboard([{ ...catalogBar, chartType: "lien" }]),
        ["p1"],
        { serverAuthoredPanelIds },
      );
      const duplicated = await verifyDashboardPanels(
        dashboard([catalogBar, catalogBar]),
        ["p1"],
        { serverAuthoredPanelIds },
      );

      expect(misspelled.panels[0].staticIssues).toEqual([
        expect.objectContaining({ kind: "unknown-chart-type" }),
      ]);
      expect(duplicated.panels[0].staticIssues).toEqual([
        expect.objectContaining({ kind: "duplicate-panel-id" }),
      ]);
    });

    it("lets verifyPanelWrite save a new server-authored panel the key rules would refuse", async () => {
      mocks.resolve.mockResolvedValue(rows(WIDE));
      const next = dashboard([catalogBar]);

      await expect(
        verifyPanelWrite({ base: null, next }),
      ).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
      });
      await expect(
        verifyPanelWrite({ base: null, next, serverAuthoredPanelIds }),
      ).resolves.toMatchObject({ verified: true });
    });
  });

  it("requires an authenticated context", async () => {
    mocks.credentials.mockReturnValue(null);

    await expect(
      verifyDashboardPanels(dashboard([panel()]), ["p1"]),
    ).rejects.toThrow("No authenticated context");
  });
});

describe("touchedPanelIds", () => {
  const base = dashboard([
    panel({ id: "a" }),
    panel({ id: "b", sql: "SELECT 1 AS n" }),
    { id: "s", title: "Section", chartType: "section", width: 6 },
  ]);

  it("ignores titles, widths, moves and sections", () => {
    const next = JSON.parse(JSON.stringify(base));
    next.panels[0].title = "Renamed";
    next.panels[0].width = 3;
    next.panels.reverse();

    expect(touchedPanelIds(base, next)).toEqual({ direct: [], affected: [] });
  });

  it("marks added and render-edited panels direct", () => {
    const next = JSON.parse(JSON.stringify(base));
    next.panels[1].config = { yKeys: ["n"] };
    next.panels.push(panel({ id: "c" }));

    expect(touchedPanelIds(base, next).direct).toEqual(["b", "c"]);
  });

  it("marks unchanged panels affected when a filter default changes their SQL", () => {
    const next = JSON.parse(JSON.stringify(base));
    next.filters[0].default = "7d";

    expect(touchedPanelIds(base, next)).toEqual({
      direct: [],
      affected: ["a"],
    });
  });
});

describe("verifyPanelWrite", () => {
  const base = dashboard([panel()]);

  function edited(config: Record<string, unknown>) {
    const next = JSON.parse(JSON.stringify(base));
    next.panels[0].config = config;
    return next;
  }

  it("returns verified:true with noRenderAffected and executes nothing when no render field changed", async () => {
    const next = JSON.parse(JSON.stringify(base));
    next.panels[0].title = "Renamed";

    const verdict = await verifyPanelWrite({ base, next });

    expect(verdict).toMatchObject({
      verified: true,
      noRenderAffected: true,
      verification: null,
    });
    expect(verdictFields(verdict)).toMatchObject({
      verified: true,
      noRenderAffected: true,
    });
    expect(annotateSummary("Saved.", verdict)).toContain(
      "No panel render was affected",
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("throws a self-contained typed error for a panel that would not render and writes nothing", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const next = edited({
      pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
    });

    const attempt = verifyPanelWrite({ base, next });

    await expect(attempt).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
      statusCode: 422,
    });
    const error = await attempt.catch((e) => e);
    expect(error.message).toContain('panel "p1" ("Signups")');
    expect(error.message).toContain("signups_4wk_avg");
    expect(error.message).toContain("Remove config.pivot");
    expect(error.message.length).toBeLessThanOrEqual(1500);
    expect(error.details.verification.panels[0].status).toBe("missing-columns");
  });

  it("lets allowEmptyResult save a legitimately empty panel as verified:false", async () => {
    mocks.resolve.mockResolvedValue(rows([], [{ name: "week", type: "DATE" }]));
    const next = edited({ yKeys: ["week"] });

    await expect(verifyPanelWrite({ base, next })).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });
    const verdict = await verifyPanelWrite({
      base,
      next,
      allowEmptyResult: true,
    });

    expect(verdict.verified).toBe(false);
    expect(verdict.unverified[0]).toMatchObject({
      panelId: "p1",
      status: "empty",
    });
    expect(verdict.nextStep).toContain("inspect-dashboard-panel");
  });

  it("never lets allowEmptyResult override missing columns or a query error", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const stalePivot = edited({
      pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
    });
    await expect(
      verifyPanelWrite({ base, next: stalePivot, allowEmptyResult: true }),
    ).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });

    mocks.resolve.mockResolvedValue({ error: "bad", message: "Syntax error" });
    await expect(
      verifyPanelWrite({
        base,
        next: edited({ yKeys: ["signups"] }),
        allowEmptyResult: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });
  });

  it("saves an unverifiable panel with verified:false and a required next step", async () => {
    mocks.resolve.mockResolvedValue({
      error: "missing_api_key",
      message: "Connect BigQuery",
    });

    const verdict = await verifyPanelWrite({
      base,
      next: edited({ yKeys: ["signups"] }),
    });

    expect(verdict.verified).toBe(false);
    expect(verdict.unverified).toEqual([
      expect.objectContaining({
        status: "unverified",
        note: "missing_credential",
      }),
    ]);
    expect(verdict.nextStep).toMatch(/^REQUIRED: call inspect-dashboard-panel/);
  });

  it("returns compact proof for a clean pass", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));

    const verdict = await verifyPanelWrite({
      base,
      next: edited({ yKeys: ["signups", "signups_4wk_avg"] }),
    });

    expect(verdict).toMatchObject({
      verified: true,
      proof: [
        {
          panelId: "p1",
          status: "ok",
          rowCount: 2,
          columns: ["week", "signups", "signups_4wk_avg"],
          missingKeys: [],
        },
      ],
      unverified: [],
    });
    expect(verdict.nextStep).toBeUndefined();
  });

  it("reports a problem in an indirectly affected panel without blocking the edit", async () => {
    mocks.resolve.mockResolvedValue(rows([], [{ name: "week", type: "DATE" }]));
    const next = JSON.parse(JSON.stringify(base));
    next.filters[0].default = "7d";

    const verdict = await verifyPanelWrite({ base, next });

    expect(verdict.verified).toBe(false);
    expect(verdict.unverified[0]).toMatchObject({
      panelId: "p1",
      status: "empty",
    });
  });

  it("tells the agent which panels were not run when more panels changed than the cap executes", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const many = dashboard(
      Array.from({ length: 9 }, (_, i) => panel({ id: `p${i}` })),
    );

    const verdict = await verifyPanelWrite({ base: null, next: many });

    expect(verdict.verified).toBe(false);
    expect(mocks.resolve).toHaveBeenCalledTimes(6);
    expect(verdict.proof).toHaveLength(6);
    expect(verdict.unverified.map((p) => p.note)).toEqual([
      "not_executed:over_budget",
      "not_executed:over_budget",
      "not_executed:over_budget",
    ]);
    expect(verdict.nextStep).toMatch(/^Not run: p6, p7, p8 were beyond/);
    expect(verdict.nextStep).not.toContain("REQUIRED");
  });

  it("report mode never throws for a broken panel", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const next = edited({
      pivot: { xKey: "week", seriesKey: "app", valueKey: "n" },
    });

    const verdict = await verifyPanelWrite({ base, next, mode: "report" });

    expect(verdict.verified).toBe(false);
    expect(verdict.unverified[0].status).toBe("missing-columns");
  });
});

describe("formatVerificationFailure", () => {
  async function failureFor(
    panelOverrides: Record<string, unknown>,
    result: unknown,
  ) {
    if (result instanceof Error) mocks.resolve.mockRejectedValue(result);
    else mocks.resolve.mockResolvedValue(result);
    const verification = await verifyDashboardPanels(
      dashboard([panel(panelOverrides)]),
      ["p1"],
    );
    return formatVerificationFailure(verification.panels);
  }

  it.each([
    [
      "stale pivot",
      { config: { pivot: { xKey: "week", seriesKey: "app", valueKey: "n" } } },
      rows(WIDE),
      ["p1", "week, signups, signups_4wk_avg", "Remove config.pivot"],
    ],
    [
      "missing yKey",
      { config: { yKeys: ["signups", "rolling"] } },
      rows(WIDE),
      [
        "p1",
        "week, signups, signups_4wk_avg",
        "missing [rolling]",
        "Add rolling",
      ],
    ],
    [
      "query error",
      {},
      { error: "bad_query", message: "Unrecognized name: nope" },
      ["p1", "Unrecognized name: nope"],
    ],
    [
      "empty by filter",
      {},
      rows([], [{ name: "week", type: "DATE" }]),
      ["p1", "0 rows", "timeRange=30d", "allowEmptyResult:true"],
    ],
  ])("is actionable for %s", async (_name, overrides, result, expected) => {
    const message = await failureFor(overrides, result);

    for (const fragment of expected) expect(message).toContain(fragment);
    expect(message).toMatch(/^Not saved:/);
    expect(message.length).toBeLessThanOrEqual(1500);
  });
});

describe("isAgentCaller", () => {
  it("covers every caller an agent loop writes through, and no UI or HTTP caller", () => {
    for (const caller of ["tool", "mcp", "a2a", "webmcp", "automation"]) {
      expect(isAgentCaller(caller)).toBe(true);
    }
    for (const caller of ["frontend", "http", "cli", undefined]) {
      expect(isAgentCaller(caller)).toBe(false);
    }
  });
});

describe("duplicate panel ids", () => {
  const SECOND_SQL = "SELECT week, signups FROM second_copy";
  const first = (overrides: Record<string, unknown> = {}) =>
    panel({
      id: "dup",
      sql: "SELECT week, signups FROM first_copy",
      ...overrides,
    });
  const second = (overrides: Record<string, unknown> = {}) =>
    panel({ id: "dup", sql: SECOND_SQL, ...overrides });

  it("runs the first panel with the id, the one the edit API addresses, and flags the duplicate", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));

    const result = await verifyDashboardPanels(dashboard([first(), second()]), [
      "dup",
    ]);

    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][0].query).toContain("first_copy");
    expect(result.panels[0].staticIssues).toEqual([
      expect.objectContaining({ kind: "duplicate-panel-id", panelId: "dup" }),
    ]);
    expect(result).toMatchObject({ verified: false, blocking: true });
  });

  it("refuses an edit to a duplicated id instead of verifying a copy that was not edited", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const base = dashboard([first(), second()]);
    const next = dashboard([
      first({ sql: "SELECT week, signups FROM edited_first_copy" }),
      second(),
    ]);

    const attempt = verifyPanelWrite({ base, next });

    await expect(attempt).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });
    expect((await attempt.catch((e) => e)).message).toContain(
      "shares its id with another panel",
    );
    expect(mocks.resolve.mock.calls[0][0].query).toContain("edited_first_copy");
  });

  it("treats a change to any copy as touching the id", () => {
    const base = dashboard([first(), second()]);
    const next = dashboard([first(), second({ sql: "SELECT 2 AS n" })]);

    expect(touchedPanelIds(base, next)).toEqual({
      direct: ["dup"],
      affected: [],
    });
    expect(touchedPanelIds(base, base)).toEqual({ direct: [], affected: [] });
  });
});

describe("failure messages with several blocking panels", () => {
  const WIDE_12 = [
    Object.fromEntries(
      ["week", ...Array.from({ length: 11 }, (_, i) => `metric_${i}`)].map(
        (key, i) => [key, i === 0 ? "2026-09-01" : i],
      ),
    ),
  ];

  async function blockers(count: number, yKey?: string) {
    mocks.resolve.mockResolvedValue(rows(WIDE_12));
    const ids = Array.from({ length: count }, (_, i) => `pivot_panel_${i}`);
    const verification = await verifyDashboardPanels(
      dashboard(
        ids.map((id) =>
          panel({
            id,
            title: `Pivoted panel number ${id}`,
            config: {
              ...(yKey ? { yKey } : {}),
              pivot: { xKey: "week", seriesKey: "app", valueKey: "sharing" },
            },
          }),
        ),
      ),
      ids,
      { maxExecuted: count },
    );
    return { ids, message: formatVerificationFailure(verification.panels) };
  }

  it.each([3, 4, 7])(
    "keeps every panel's fix hint within the cap for %i blockers",
    async (count) => {
      const { ids, message } = await blockers(count, "sharing");

      expect(message.length).toBeLessThanOrEqual(1500);
      const lines = message.split("\n").filter((l) => l.startsWith("- panel"));
      expect(lines.length).toBeGreaterThanOrEqual(3);
      for (const line of lines) {
        expect(line).toContain("Remove config.pivot and config.yKey");
        expect(line).toContain("config.yKeys to the numeric columns");
        expect(line).toMatch(/or change the SQL back to long format\.$/);
      }
      expect(lines.map((l) => /"(pivot_panel_\d)"/.exec(l)![1])).toEqual(
        ids.slice(0, lines.length),
      );
      if (count > lines.length) {
        expect(message).toContain(`+${count - lines.length} more`);
      }
    },
  );

  it("tells the agent to clear the leftover yKey beside a stale pivot, and only then", async () => {
    const withYKey = await blockers(1, "sharing");
    const without = await blockers(1);

    expect(withYKey.message).toContain("config.yKey (patch both to null)");
    expect(without.message).toContain("Remove config.pivot (patch it to null)");
    expect(without.message).not.toContain("patch both");
  });
});

describe("renderer-aware verification", () => {
  it("reports a funnel the viewer sees as empty, not ok", async () => {
    mocks.resolve.mockResolvedValue(
      rows([
        { stage: 1, users: 100 },
        { stage: 2, users: 50 },
      ]),
    );
    const config = dashboard([
      panel({
        chartType: "funnel",
        config: { xKey: "stage", yKey: "users" },
      }),
    ]);

    const result = await verifyDashboardPanels(config, ["p1"]);

    expect(result.panels[0]).toMatchObject({
      status: "empty",
      rowCount: 2,
      renderedRowCount: 0,
    });
    expect(result).toMatchObject({ verified: false, blocking: true });
  });

  it("says rows came back but none render, never that the query is empty", async () => {
    const funnel = panel({
      chartType: "funnel",
      config: { xKey: "stage", yKey: "users" },
    });
    mocks.resolve.mockResolvedValue(
      rows([
        { stage: 1, users: 100 },
        { stage: 2, users: 50 },
      ]),
    );
    const withRows = (await verifyDashboardPanels(dashboard([funnel]), ["p1"]))
      .panels[0];
    mocks.resolve.mockResolvedValue(
      rows(
        [],
        ["stage", "users"].map((name) => ({ name, type: "STRING" })),
      ),
    );
    const noRows = (await verifyDashboardPanels(dashboard([funnel]), ["p1"]))
      .panels[0];

    expect(describePanelOutcome(withRows)).toContain("returns 2 row(s) but 0");
    expect(describePanelOutcome(withRows)).not.toContain("no rows");
    expect(describePanelOutcome(noRows)).toBe(
      'returns no rows, so it shows "No data"',
    );
  });

  it("reports a single-column heatmap as empty", async () => {
    mocks.resolve.mockResolvedValue(rows([{ cohort: "w1" }, { cohort: "w2" }]));

    const result = await verifyDashboardPanels(
      dashboard([panel({ chartType: "heatmap" })]),
      ["p1"],
    );

    expect(result.panels[0].status).toBe("empty");
  });

  it("turns a renderer failure into a typed verdict that names the panel and blocks the save", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    mocks.planFailure.current = new Error("boom in planning");
    const base = dashboard([panel()]);
    const next = dashboard([panel({ config: { yKeys: ["signups"] } })]);

    const attempt = verifyPanelWrite({ base, next });

    await expect(attempt).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });
    const error = await attempt.catch((e) => e);
    expect(error.message).toContain('panel "p1"');
    expect(error.message).toContain("the renderer cannot draw this result");
    expect(error.details.verification.panels[0].status).toBe("render-error");
  });

  it("blocks a misshapen key list with a typed issue before it can crash anything", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const base = dashboard([panel()]);
    const next = dashboard([panel({ config: { yKeys: "signups" } })]);

    const attempt = verifyPanelWrite({ base, next });

    await expect(attempt).rejects.toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
    });
    expect((await attempt.catch((e) => e)).message).toContain(
      "config.yKeys must be an array",
    );
  });
});

describe("what the store saves is what gets verified", () => {
  it("runs the SQL a legacy config.sql is promoted to and accepts legacy panel fields under config", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const legacy = panel({
      sql: "SELECT week, signups FROM stale",
      config: { sql: "SELECT week, signups FROM promoted", width: 3 },
    });

    const result = await verifyDashboardPanels(dashboard([legacy]), ["p1"]);

    expect(mocks.resolve.mock.calls[0][0].query).toContain("promoted");
    expect(result.panels[0].staticIssues).toEqual([]);
    expect(result.panels[0].status).toBe("ok");
  });

  it("applies the known first-party repairs the page applies, only for that dashboard", async () => {
    const stored = {
      name: "First-party",
      filters: [
        { ...TIME_RANGE_FILTER, default: "all" },
        {
          id: "emailFilter",
          label: "Email",
          type: "select",
          default: "all",
          options: [{ value: "all", label: "All" }],
        },
      ],
      panels: [panel()],
    };

    const repaired = pageDashboardConfig(
      stored,
      "agent-native-templates-first-party-bigquery-v2",
    );
    const untouched = pageDashboardConfig(stored, "some-user-dashboard");

    expect(resolveVerificationVars(repaired)).toMatchObject({
      timeRange: "90d",
      emailFilter: "exclude_builder",
    });
    expect(resolveVerificationVars(untouched).timeRange).toBe("all");
  });

  it("verifies a write with the repaired defaults when the dashboard id is known", async () => {
    mocks.resolve.mockResolvedValue(rows(WIDE));
    const stored = {
      name: "First-party",
      filters: [{ ...TIME_RANGE_FILTER, default: "all" }],
      panels: [panel()],
    };
    const next = JSON.parse(JSON.stringify(stored));
    next.panels[0].config = { yKeys: ["signups"] };

    const verdict = await verifyPanelWrite({
      base: stored,
      next,
      dashboardId: "agent-native-templates-first-party-bigquery-v2",
    });

    expect(verdict.verified).toBe(true);
    expect(mocks.resolve.mock.calls[0][0].query).toContain("range = '90d'");
  });
});

describe("error text from the warehouse", () => {
  it("redacts and clips a dry-run failure like an executed one", async () => {
    // Assembled at runtime so no credential-shaped literal sits in the source.
    const fakeKey = ["sk", "live", "abcdef0123456789"].join("_");
    mocks.dryRun.mockResolvedValue({
      error: `Access Denied on project builder-3b0a2 token=${fakeKey} ${"x".repeat(900)}`,
    });

    const result = await verifyDashboardPanels(dashboard([panel()]), ["p1"]);

    const [verified] = result.panels;
    expect(verified.status).toBe("query-error");
    expect(verified.error).not.toContain(fakeKey);
    expect(verified.error).toContain("[redacted]");
    expect(verified.error!.length).toBeLessThanOrEqual(501);
  });
});

describe("clipping text a model reads", () => {
  const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  // One extra character flips whether a cut lands inside an emoji pair; the
  // text stays under the 500 units the warehouse-error redaction keeps.
  const EMOJI_RUNS = ["😀".repeat(200), `x${"😀".repeat(199)}`];
  const TITLES = ["a", "aa"];

  it.each(EMOJI_RUNS.flatMap((text) => TITLES.map((title) => [title, text])))(
    "never ends a failure line or a sampled cell on half an emoji (%s, %#)",
    async (shortTitle, text) => {
      mocks.resolve.mockResolvedValue({ error: "bad_query", message: text });
      const ids = ["p1", "p2", "p3", "p4"];
      const failed = await verifyDashboardPanels(
        dashboard(
          ids.map((id) =>
            panel({ id, title: id === "p1" ? text : shortTitle + id }),
          ),
        ),
        ids,
      );
      mocks.resolve.mockResolvedValue(
        rows([{ week: "2026-09-01", note: text }]),
      );
      const sampled = await verifyDashboardPanels(
        dashboard([panel({ chartType: "table" })]),
        ["p1"],
        { sampleRows: 1 },
      );

      expect(formatVerificationFailure(failed.panels)).not.toMatch(
        LONE_SURROGATE,
      );
      expect(describePanelOutcome(failed.panels[0])).not.toMatch(
        LONE_SURROGATE,
      );
      expect(JSON.stringify(sampled.panels[0].sample)).not.toMatch(
        LONE_SURROGATE,
      );
    },
  );
});

describe("section and extension panels", () => {
  const section = (overrides: Record<string, unknown> = {}) => ({
    id: "s",
    title: "Overview",
    chartType: "section",
    width: 6,
    ...overrides,
  });
  const extension = (overrides: Record<string, unknown> = {}) => ({
    id: "x",
    title: "Embed",
    chartType: "extension",
    width: 3,
    config: { extensionId: "ext-1" },
    ...overrides,
  });
  const base = dashboard([panel(), section(), extension()]);

  describe("touchedVisualPanels", () => {
    it("reports a section or extension panel that was added, edited or removed", () => {
      const next = dashboard([
        panel(),
        section({ title: "Renamed" }),
        extension({ id: "x2" }),
      ]);

      expect(touchedVisualPanels(base, next)).toEqual([
        {
          panelId: "s",
          title: "Renamed",
          chartType: "section",
          change: "changed",
        },
        {
          panelId: "x2",
          title: "Embed",
          chartType: "extension",
          change: "added",
        },
        {
          panelId: "x",
          title: "Embed",
          chartType: "extension",
          change: "removed",
        },
      ]);
    });

    it("ignores moves, unchanged panels and data-panel edits", () => {
      const next = JSON.parse(JSON.stringify(base));
      next.panels[0].sql = "SELECT 2";
      next.panels.reverse();

      expect(touchedVisualPanels(base, next)).toEqual([]);
    });

    it("treats every section and extension panel of a new dashboard as added", () => {
      expect(touchedVisualPanels(null, base).map((c) => c.change)).toEqual([
        "added",
        "added",
      ]);
    });
  });

  describe("verifyPanelWrite", () => {
    it("never claims no render was affected for a visible edit, and says its data was not checked", async () => {
      const next = dashboard([
        panel(),
        section({ title: "Renamed" }),
        extension(),
      ]);

      const verdict = await verifyPanelWrite({ base, next });

      expect(verdict).toMatchObject({
        verified: true,
        visualOnly: [{ panelId: "s", change: "changed" }],
      });
      expect(verdict.noRenderAffected).toBeUndefined();
      expect(verdict.verification?.panels).toEqual([
        expect.objectContaining({
          panelId: "s",
          status: "ok",
          visualOnly: true,
        }),
      ]);
      const fields = verdictFields(verdict);
      expect(fields).toMatchObject({
        verified: true,
        visualOnly: [{ panelId: "s", change: "changed" }],
      });
      expect(fields).not.toHaveProperty("noRenderAffected");
      const message = annotateSummary("Saved.", verdict);
      expect(message).toContain('changed "Renamed"');
      expect(message).toContain("not their data");
      expect(message).not.toContain("No panel render was affected");
      expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("reports a removed extension panel as a visible change with nothing to check", async () => {
      const verdict = await verifyPanelWrite({
        base,
        next: dashboard([panel(), section()]),
      });

      expect(verdict).toMatchObject({
        verified: true,
        visualOnly: [{ panelId: "x", change: "removed" }],
        proof: [],
      });
      expect(verdict.noRenderAffected).toBeUndefined();
      expect(annotateSummary("Saved.", verdict)).toContain('removed "Embed"');
    });

    it("still applies the config-key rules to an agent-authored extension panel", async () => {
      const next = dashboard([
        panel(),
        section(),
        extension({ config: { extensionId: "ext-1", yKye: ["n"] } }),
      ]);

      const attempt = verifyPanelWrite({ base, next });

      await expect(attempt).rejects.toMatchObject({
        errorCode: "dashboard_panel_verification_failed",
      });
      expect((await attempt.catch((e) => e)).message).toContain("yKye");
      expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("does not send the agent to inspect a panel that has nothing to inspect", async () => {
      const next = dashboard([
        panel(),
        section(),
        extension({ config: { extensionId: "ext-1", yKye: ["n"] } }),
      ]);

      const verdict = await verifyPanelWrite({ base, next, mode: "report" });

      expect(verdict.verified).toBe(false);
      expect(verdict.nextStep).toContain("fix the config of x");
      expect(verdict.nextStep).not.toContain("inspect-dashboard-panel");
    });

    it("verifies a changed data panel and a section edit in the same save", async () => {
      mocks.resolve.mockResolvedValue(rows(WIDE));
      const before = dashboard([panel(), section()]);
      const next = dashboard([
        panel({ sql: "SELECT week, signups FROM edited" }),
        section({ title: "Renamed" }),
      ]);

      const verdict = await verifyPanelWrite({ base: before, next });

      expect(verdict.verified).toBe(true);
      expect(verdict.proof).toEqual([
        expect.objectContaining({ panelId: "p1", status: "ok" }),
      ]);
      expect(verdict.visualOnly).toHaveLength(1);
      const message = annotateSummary("Saved.", verdict);
      expect(message).toContain("Verified: Signups");
      expect(message).toContain("not their data");
    });
  });
});
