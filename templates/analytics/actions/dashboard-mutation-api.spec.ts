import { describe, expect, it } from "vitest";

import { buildDashboardPanelGroups } from "../app/pages/adhoc/sql-dashboard/dashboard-layout";
import {
  clampDashboardColumns,
  type SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import {
  DASHBOARD_MUTATION_API_TYPES,
  DASHBOARD_MUTATION_EXAMPLES,
  applyDashboardMutationOperations,
  parseDashboardMutationScript,
} from "./dashboard-mutation-api";

function panel(id: string, title = id) {
  return {
    id,
    title,
    source: "first-party",
    chartType: "metric",
    width: 1,
    sql: "SELECT COUNT(*) AS value FROM analytics_events",
  };
}

function config() {
  return {
    name: "Weekly",
    columns: 2,
    filters: [
      {
        id: "emailFilter",
        type: "select",
        label: "Email filter",
        default: "all",
        options: [
          { value: "all", label: "All users" },
          { value: "exclude_builder", label: "Exclude @builder.io" },
        ],
      },
    ],
    panels: [
      panel("a", "Alpha"),
      panel("b", "Signed-In Daily Active Visitors"),
      panel("c", "Signed-In Weekly Active Visitors"),
      {
        id: "section",
        title: "Section",
        chartType: "section",
        width: 1,
        columns: 2,
      },
      panel("d", "Delta"),
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function renderedRows(root: { columns?: number; panels: unknown[] }) {
  return buildDashboardPanelGroups(
    root.panels as SqlPanel[],
    clampDashboardColumns(root.columns),
  ).flatMap((group) => group.rows.map((row) => row.panels.map((p) => p.id)));
}

describe("dashboard mutation api", () => {
  it("uses the seeded dashboard timeRange filter in first-party insert examples", () => {
    const examples = DASHBOARD_MUTATION_EXAMPLES.filter(
      (example) =>
        example.includes("dashboard.insertPanel") &&
        example.includes('"source":"first-party"'),
    );

    expect(examples).toHaveLength(3);
    for (const example of examples) {
      expect(example).toContain("{{timeRange}}");
      expect(example).toContain("{{timeRangeStart}}");
      expect(example).toContain("{{timeRangeEnd}}");
      expect(example).not.toContain("{{dateStart}}");
    }
  });

  it("parses and applies id-based moves, panel patches, and dashboard patches", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      [
        'dashboard.panels(["b","c"]).moveToTop();',
        'dashboard.panel("a").setTitle("Renamed Alpha");',
        'dashboard.set({"columns":3});',
      ].join("\n"),
    );

    const result = applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
      "section",
      "d",
    ]);
    expect(root.panels[2].title).toBe("Renamed Alpha");
    expect(root.columns).toBe(3);
    expect(result.changedPanelIds).toEqual(["b", "c", "a"]);
    expect(result.dashboardFieldsChanged).toEqual(["columns"]);
    expect(result.commandLog).toEqual([
      "movePanels(b, c) -> index 0",
      "updatePanel(a: title)",
      "setDashboard(columns)",
    ]);
  });

  it("does not report same-value panel patches as changed", () => {
    const root = clone(config());
    const firstPanel = root.panels[0] as Record<string, unknown>;
    firstPanel.config = {
      xKey: "date",
      yKeys: ["signups"],
      yAxis: { format: "percent", minimum: 0 },
    };
    const original = clone(root);

    const result = applyDashboardMutationOperations(root, [
      {
        op: "updatePanel",
        panelId: "a",
        patch: {
          title: "Alpha",
          config: {
            yAxis: { minimum: 0, format: "percent" },
            yKeys: ["signups"],
            xKey: "date",
          },
        },
      },
    ]);

    expect(root).toEqual(original);
    expect(result.changedPanelIds).toEqual([]);
    expect(result.commandLog).toEqual(["updatePanel(a: no fields)"]);
  });

  it("does not report same-position moves or config-path patches as changed", () => {
    const root = clone(config());
    const firstPanel = root.panels[0] as Record<string, unknown>;
    firstPanel.config = { yAxis: { format: "percent" } };
    const original = clone(root);

    const result = applyDashboardMutationOperations(root, [
      { op: "movePanels", panelIds: ["a"], position: "top" },
      {
        op: "updatePanelPath",
        panelId: "a",
        path: "yAxis.format",
        value: "percent",
      },
    ]);

    expect(root).toEqual(original);
    expect(result.changedPanelIds).toEqual([]);
    expect(result.movedPanelIds).toEqual([]);
    expect(result.commandLog).toEqual([
      "movePanels(no order change) -> index 0",
      "updatePanelPath(a: config.yAxis.format unchanged)",
    ]);
  });

  it("does not report same-value dashboard fields or filter defaults as changed", () => {
    const root = clone(config());
    root.name = "Traffic";
    root.filters = [{ id: "period", default: "30d" }];
    const original = clone(root);

    const result = applyDashboardMutationOperations(root, [
      { op: "setDashboard", patch: { name: "Traffic" } },
      { op: "setFilterDefault", filterId: "period", value: "30d" },
    ]);

    expect(root).toEqual(original);
    expect(result.dashboardFieldsChanged).toEqual([]);
    expect(result.commandLog).toEqual([
      "setDashboard(no changes)",
      'setFilterDefault(period: "30d" unchanged)',
    ]);
  });

  it("supports matching panels by metadata and appending to a section", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      [
        'dashboard.panelsMatching({"titleIncludes":"Signed-In"}).moveToTop();',
        'dashboard.section("section").append(["d"]);',
      ].join("\n"),
    );

    applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
      "section",
      "d",
    ]);
  });

  it("supports bulk field edits and nested config path edits", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      [
        'dashboard.panelsMatching({"titleIncludes":"Signed-In"}).setWidth(2);',
        'dashboard.panels(["b","c"]).setConfigPath("yAxis.format","percent");',
      ].join("\n"),
    );

    const result = applyDashboardMutationOperations(root, operations);
    const signedInPanels = root.panels.filter(
      (p) => p.id === "b" || p.id === "c",
    );

    expect(signedInPanels.map((p) => p.width)).toEqual([2, 2]);
    expect(signedInPanels.map((p) => p.config)).toEqual([
      { yAxis: { format: "percent" } },
      { yAxis: { format: "percent" } },
    ]);
    expect(result.changedPanelIds).toEqual(["b", "c"]);
    expect(result.commandLog).toEqual([
      "updatePanel(b: width)",
      "updatePanel(c: width)",
      "updatePanelPath(b: config.yAxis.format)",
      "updatePanelPath(c: config.yAxis.format)",
    ]);
  });

  it("sets one existing filter default without replacing the filters array", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      'dashboard.setFilterDefault("emailFilter","exclude_builder");',
    );

    expect(operations).toEqual([
      {
        op: "setFilterDefault",
        filterId: "emailFilter",
        value: "exclude_builder",
      },
    ]);

    const result = applyDashboardMutationOperations(root, operations);

    expect(root.filters).toEqual([
      {
        id: "emailFilter",
        type: "select",
        label: "Email filter",
        default: "exclude_builder",
        options: [
          { value: "all", label: "All users" },
          { value: "exclude_builder", label: "Exclude @builder.io" },
        ],
      },
    ]);
    expect(result.dashboardFieldsChanged).toEqual([
      "filters.emailFilter.default",
    ]);
    expect(result.commandLog).toEqual([
      'setFilterDefault(emailFilter: "exclude_builder")',
    ]);
  });

  it("rejects a missing filter or a default outside its options", () => {
    const missingRoot = clone(config());
    const missingOperations = parseDashboardMutationScript(
      missingRoot,
      'dashboard.setFilterDefault("missing","all");',
    );
    expect(() =>
      applyDashboardMutationOperations(missingRoot, missingOperations),
    ).toThrow(/filter "missing" was not found/);

    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      'dashboard.setFilterDefault("emailFilter","unknown");',
    );
    expect(() => applyDashboardMutationOperations(root, operations)).toThrow(
      /default "unknown" is not one of its option values/,
    );
  });

  it("can insert and duplicate panels with explicit placement", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      [
        'dashboard.insertPanel({"id":"new","title":"New","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(*) AS value FROM analytics_events"}).atTop();',
        'dashboard.panel("a").duplicate("a-copy", {"title":"Alpha Copy"});',
      ].join("\n"),
    );

    const result = applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "new",
      "a",
      "b",
      "c",
      "section",
      "d",
      "a-copy",
    ]);
    expect(result.insertedPanelIds).toEqual(["new", "a-copy"]);
  });

  it("duplicates a panel next to its source in one script statement", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      'dashboard.panel("b").duplicate("b-bar", {"title":"Signed-In Visitors (Bar)","chartType":"bar"}).nextTo("b");',
    );

    expect(operations).toEqual([
      {
        op: "duplicatePanel",
        panelId: "b",
        newPanelId: "b-bar",
        patch: {
          title: "Signed-In Visitors (Bar)",
          chartType: "bar",
        },
        nextToPanelId: "b",
      },
    ]);

    const result = applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "a",
      "b",
      "b-bar",
      "c",
      "section",
      "d",
    ]);
    expect(root.columns).toBe(3);
    expect(renderedRows(root)).toEqual([["a", "b", "b-bar"], ["c"], ["d"]]);
    expect(result.commandLog).toEqual([
      "duplicatePanel(b -> b-bar) -> index 2",
    ]);
  });

  it("rejects duplicate chains with an invalid selection or placement", () => {
    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panels(["a","b"]).duplicate("copy");',
      ),
    ).toThrow(/duplicate requires exactly one selected panel/);

    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panel("a").duplicate("a-copy").nextTo("b").atTop();',
      ),
    ).toThrow(/duplicate accepts at most one placement method/);

    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panel("a").duplicate("a-copy").setTitle("Copy");',
      ),
    ).toThrow(/unsupported placement method "setTitle"/);
  });

  it("inserts next to a panel in the same rendered row", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      'dashboard.insertPanel({"id":"new","title":"New","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(*) AS value FROM analytics_events"}).nextTo("b");',
    );

    const result = applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "a",
      "b",
      "new",
      "c",
      "section",
      "d",
    ]);
    expect(root.columns).toBe(3);
    expect(renderedRows(root)).toEqual([["a", "b", "new"], ["c"], ["d"]]);
    expect(result.commandLog).toEqual(["insertPanel(new) -> index 2"]);
  });

  it("places inserted panels by 1-based visible row number", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      'dashboard.insertPanel({"id":"new","title":"New","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(*) AS value FROM analytics_events"}).atRow(2);',
    );

    applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
      "new",
      "section",
      "d",
    ]);
    expect(renderedRows(root)).toEqual([["a", "b"], ["c", "new"], ["d"]]);
  });

  it("moves existing panels next to targets in the same rendered row", () => {
    const root = clone(config());
    const operations = parseDashboardMutationScript(
      root,
      'dashboard.panel("c").nextTo("b");',
    );

    applyDashboardMutationOperations(root, operations);

    expect(root.panels.map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
      "section",
      "d",
    ]);
    expect(root.columns).toBe(3);
    expect(renderedRows(root)).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("rejects arbitrary JavaScript-shaped code", () => {
    expect(() =>
      parseDashboardMutationScript(config(), 'const id = "a";'),
    ).toThrow(/dashboard\./);
    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panel(`a`).setTitle("Alpha");',
      ),
    ).toThrow(/template literals/);
    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panel("a").set({title:"Alpha"});',
      ),
    ).toThrow(/JSON-compatible/);
  });

  it("returns teachable statement errors", () => {
    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panel("signed-in-daily").setTitle("Daily");',
      ),
    ).toThrow(
      /statement 1 .*panel "signed-in-daily" was not found.*Did you mean "b"/,
    );

    expect(() =>
      parseDashboardMutationScript(config(), 'dashboard.panel("a").resize(2);'),
    ).toThrow(/statement 1 .*unsupported panel method "resize".*Valid methods/);

    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panelsMatching({"titleIncludes":"Revenue"}).moveToTop();',
      ),
    ).toThrow(/statement 1 .*did not match any panels.*Candidate panels/);

    expect(() =>
      parseDashboardMutationScript(
        config(),
        [
          'dashboard.panel("a").setTitle("Alpha");',
          'dashboard.panel("b").setWidth("wide");',
        ].join("\n"),
      ),
    ).toThrow(/statement 2 .*width must be a finite number/);

    expect(() =>
      parseDashboardMutationScript(
        config(),
        'dashboard.panel("b").setConfigPath("yAxis.format");',
      ),
    ).toThrow(/statement 1 .*setConfigPath requires path and value/);
  });

  it("rejects panel id changes and gives structured op context", () => {
    const root = clone(config());

    expect(() =>
      applyDashboardMutationOperations(root, [
        { op: "updatePanel", panelId: "a", patch: { id: "renamed" } },
      ]),
    ).toThrow(/operation 1 \(updatePanel\).*panel\.id cannot be changed/);
  });

  it("teaches only config keys the renderer honors", () => {
    expect(DASHBOARD_MUTATION_API_TYPES).not.toContain("yAxis");
    expect(DASHBOARD_MUTATION_API_TYPES).toContain('e.g. "yFormatter"');
    expect(DASHBOARD_MUTATION_EXAMPLES).toContain(
      'dashboard.panel("retention").setConfigPath("yFormatter","percent");',
    );
    expect(DASHBOARD_MUTATION_API_TYPES).toMatch(/chartType\?:.*"combo"/);
    expect(DASHBOARD_MUTATION_API_TYPES).toContain("window-function column");
    expect(DASHBOARD_MUTATION_API_TYPES).toContain(
      "first-party: AVG is not an approved function",
    );
    expect(DASHBOARD_MUTATION_EXAMPLES.join("\n")).not.toContain("yAxis");
    expect(() =>
      applyDashboardMutationOperations(clone(config()), [
        { op: "updatePanelPath", panelId: "a", path: "config", value: 1 },
      ]),
    ).toThrow(/e\.g\. "yFormatter"/);
  });

  describe("effective-change diff", () => {
    it("reports only the ops that changed something in the ids and command log", () => {
      const root = clone(config());

      const result = applyDashboardMutationOperations(root, [
        { op: "updatePanel", panelId: "a", patch: { title: "Renamed" } },
        {
          op: "updatePanel",
          panelId: "b",
          patch: { title: "Signed-In Daily Active Visitors" },
        },
        {
          op: "updatePanelPath",
          panelId: "c",
          path: "yFormatter",
          value: "percent",
        },
        {
          op: "updatePanelPath",
          panelId: "c",
          path: "yFormatter",
          value: "percent",
        },
      ]);

      expect(result.changedPanelIds).toEqual(["a", "c"]);
      expect(result.commandLog).toEqual([
        "updatePanel(a: title)",
        "updatePanel(b: no fields)",
        "updatePanelPath(c: config.yFormatter)",
        "updatePanelPath(c: config.yFormatter unchanged)",
      ]);
    });

    it("reports a fully identical batch as unchanged", () => {
      const root = clone(config());

      const result = applyDashboardMutationOperations(root, [
        {
          op: "updatePanel",
          panelId: "a",
          patch: { title: "Alpha", width: 1 },
        },
        { op: "updatePanel", panelId: "a", patch: {} },
        { op: "movePanels", panelIds: ["a"], position: "top" },
        { op: "setFilterDefault", filterId: "emailFilter", value: "all" },
        { op: "setDashboard", patch: { columns: 2 } },
      ]);

      expect(result).toMatchObject({
        changedPanelIds: [],
        movedPanelIds: [],
        insertedPanelIds: [],
        removedPanelIds: [],
        dashboardFieldsChanged: [],
      });
      expect(root).toEqual(config());
    });

    it("does not count a title-only edit as a render change but does count a move", () => {
      const root = clone(config());

      const result = applyDashboardMutationOperations(root, [
        { op: "updatePanel", panelId: "a", patch: { title: "Renamed" } },
        { op: "movePanels", panelIds: ["d"], position: "top" },
      ]);

      expect(result.changedPanelIds).toEqual(["a", "d"]);
    });

    it("reports a filter default and dashboard field only when the value moved", () => {
      const root = clone(config());

      const result = applyDashboardMutationOperations(root, [
        {
          op: "setFilterDefault",
          filterId: "emailFilter",
          value: "exclude_builder",
        },
        { op: "setDashboard", patch: { columns: 2, description: "New" } },
      ]);

      expect(result.dashboardFieldsChanged).toEqual([
        "filters.emailFilter.default",
        "description",
      ]);
    });
  });
});
