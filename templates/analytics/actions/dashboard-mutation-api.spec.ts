import { describe, expect, it } from "vitest";

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
});
