import { describe, expect, it } from "vitest";

import { buildDashboardPanelGroups } from "../app/pages/adhoc/sql-dashboard/dashboard-layout";
import {
  clampDashboardColumns,
  type SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import {
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
});
