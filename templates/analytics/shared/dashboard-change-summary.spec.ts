import { describe, expect, it } from "vitest";

import {
  describeDashboardChanges,
  MAX_STORED_DASHBOARD_CHANGES,
  parseDashboardChangeSummary,
  summarizeDashboardChanges,
} from "./dashboard-change-summary";

function panel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: id.toUpperCase(),
    sql: `SELECT 1 AS ${id}`,
    source: "first-party",
    chartType: "line",
    width: 1,
    ...overrides,
  };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    name: "Growth",
    panels: [panel("dau"), panel("wau")],
    ...overrides,
  };
}

function signupsTable(columns?: Array<Record<string, unknown>>) {
  return panel("signups", {
    title: "Signups by Template",
    chartType: "table",
    ...(columns ? { config: { columns } } : {}),
  });
}

describe("describeDashboardChanges", () => {
  it("finds nothing when the configs are the same, even with unset fields", () => {
    expect(describeDashboardChanges(dashboard(), dashboard())).toEqual([]);
    expect(
      describeDashboardChanges(
        dashboard({ description: undefined }),
        dashboard(),
      ),
    ).toEqual([]);
  });

  it("names a renamed dashboard and a changed description", () => {
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({ name: "Growth (weekly)", description: "For Monday" }),
      ),
    ).toEqual([
      { kind: "dashboard-renamed", from: "Growth", to: "Growth (weekly)" },
      { kind: "description-changed" },
    ]);
  });

  it("doesn't call a change in spacing a rename", () => {
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({
          name: "Growth ",
          panels: [panel("dau", { title: " DAU" }), panel("wau")],
        }),
      ),
    ).toEqual([{ kind: "other" }]);
  });

  it("names added, removed, and renamed panels", () => {
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({
          panels: [panel("dau", { title: "Daily actives" }), panel("mau")],
        }),
      ),
    ).toEqual([
      { kind: "panel-renamed", from: "DAU", to: "Daily actives" },
      { kind: "panel-added", title: "MAU" },
      { kind: "panel-removed", title: "WAU" },
    ]);
  });

  it("separates query changes from display changes", () => {
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({
          panels: [
            panel("dau", { sql: "SELECT 2 AS dau" }),
            panel("wau", { chartType: "bar", config: { stacked: true } }),
          ],
        }),
      ),
    ).toEqual([
      { kind: "panel-query-changed", title: "DAU" },
      { kind: "panel-display-changed", title: "WAU" },
    ]);
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({
          panels: [
            panel("dau", { config: { timeScope: "all-time" } }),
            panel("wau", { source: "bigquery" }),
          ],
        }),
      ),
    ).toEqual([
      { kind: "panel-query-changed", title: "DAU" },
      { kind: "panel-query-changed", title: "WAU" },
    ]);
  });

  it("says which way a table column was resized", () => {
    const before = dashboard({
      panels: [signupsTable([{ key: "template", width: 120 }, { key: "n" }])],
    });
    const widen = (width: number) =>
      dashboard({
        panels: [signupsTable([{ key: "template", width }, { key: "n" }])],
      });

    expect(describeDashboardChanges(before, widen(220))).toEqual([
      {
        kind: "column-resized",
        title: "Signups by Template",
        columns: 1,
        direction: "wider",
      },
    ]);
    expect(describeDashboardChanges(before, widen(80))).toEqual([
      {
        kind: "column-resized",
        title: "Signups by Template",
        columns: 1,
        direction: "narrower",
      },
    ]);
  });

  it("treats the first resize of an unconfigured table as a resize only", () => {
    // The header writes every visible key the first time a column is edited.
    expect(
      describeDashboardChanges(
        dashboard({ panels: [signupsTable()] }),
        dashboard({
          panels: [
            signupsTable([
              { key: "template", width: 180 },
              { key: "n" },
              { key: "share" },
            ]),
          ],
        }),
      ),
    ).toEqual([
      {
        kind: "column-resized",
        title: "Signups by Template",
        columns: 1,
        direction: null,
      },
    ]);
  });

  it("reports other column edits apart from widths", () => {
    const before = dashboard({
      panels: [
        signupsTable([
          { key: "template", width: 120 },
          { key: "n", width: 90 },
        ]),
      ],
    });
    expect(
      describeDashboardChanges(
        before,
        dashboard({
          panels: [
            signupsTable([
              { key: "n", width: 100, label: "Signups" },
              { key: "template", width: 140 },
            ]),
          ],
        }),
      ),
    ).toEqual([
      {
        kind: "column-resized",
        title: "Signups by Template",
        columns: 2,
        direction: null,
      },
      { kind: "columns-changed", title: "Signups by Template" },
    ]);
  });

  it("names each resized panel, and calls moves a layout change", () => {
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({ panels: [panel("dau", { width: 2 }), panel("wau")] }),
      ),
    ).toEqual([{ kind: "panel-resized", title: "DAU" }]);
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({
          panels: [panel("dau", { width: 2 }), panel("wau", { width: 2 })],
        }),
      ),
    ).toEqual([
      { kind: "panel-resized", title: "DAU" },
      { kind: "panel-resized", title: "WAU" },
    ]);
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({ panels: [panel("wau"), panel("dau")] }),
      ),
    ).toEqual([{ kind: "layout-changed" }]);
    expect(
      describeDashboardChanges(dashboard(), dashboard({ columns: 3 })),
    ).toEqual([{ kind: "layout-changed" }]);
  });

  it("leaves out the width reflow that comes with adding, removing or moving a panel", () => {
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({ panels: [panel("dau", { width: 2 })] }),
      ),
    ).toEqual([{ kind: "panel-removed", title: "WAU" }]);
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({
          panels: [panel("wau", { width: 2 }), panel("dau", { width: 2 })],
        }),
      ),
    ).toEqual([{ kind: "layout-changed" }]);
  });

  it("names added, changed, and removed filters by label", () => {
    const range = { id: "timeRange", label: "Time range", type: "date-range" };
    const region = { id: "region", label: "Region", type: "select" };
    expect(
      describeDashboardChanges(
        dashboard({ filters: [range, region] }),
        dashboard({
          filters: [
            { ...range, default: "30d" },
            { id: "plan", label: "Plan", type: "select" },
          ],
        }),
      ),
    ).toEqual([
      { kind: "filter-changed", label: "Time range" },
      { kind: "filter-added", label: "Plan" },
      { kind: "filter-removed", label: "Region" },
    ]);
  });

  it("orders changes: dashboard, panels in order, removals, layout, filters, other", () => {
    expect(
      describeDashboardChanges(
        dashboard({ filters: [] }),
        dashboard({
          name: "Growth v2",
          variables: { region: "eu" },
          filters: [{ id: "plan", label: "Plan", type: "select" }],
          panels: [panel("mau"), panel("dau", { sql: "SELECT 3 AS dau" })],
          columns: 3,
        }),
      ).map((change) => change.kind),
    ).toEqual([
      "dashboard-renamed",
      "panel-added",
      "panel-query-changed",
      "panel-removed",
      "layout-changed",
      "filter-added",
      "other",
    ]);
  });

  it("describes explorer charts, which have no titles", () => {
    const chart = (id: string, width = 1) => ({ id, configId: id, width });
    expect(
      describeDashboardChanges(
        { name: "Explorer", charts: [chart("a"), chart("b")] },
        { name: "Explorer", charts: [chart("a", 2), chart("b")] },
      ),
    ).toEqual([{ kind: "panel-resized", title: null }]);
    expect(
      describeDashboardChanges(
        { name: "Explorer", charts: [chart("a")] },
        { name: "Explorer", charts: [chart("a"), chart("c")] },
      ),
    ).toEqual([{ kind: "panel-added", title: null }]);
  });

  it("falls back to one 'other' when the change can't be named", () => {
    expect(describeDashboardChanges(dashboard(), "not a config")).toEqual([
      { kind: "other" },
    ]);
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({ panels: [{ title: "No id" }] }),
      ),
    ).toEqual([{ kind: "other" }]);
    expect(
      describeDashboardChanges(
        dashboard(),
        dashboard({ panels: [panel("dau", { title: "" }), panel("wau")] }),
      ),
    ).toEqual([{ kind: "other" }]);
  });

  it("shortens long names", () => {
    const [change] = describeDashboardChanges(
      dashboard(),
      dashboard({
        panels: [
          panel("dau"),
          panel("wau"),
          panel("x", { title: "y".repeat(500) }),
        ],
      }),
    );
    expect(change).toMatchObject({ kind: "panel-added" });
    expect((change as { title: string }).title).toHaveLength(120);
    expect((change as { title: string }).title.endsWith("…")).toBe(true);
  });
});

describe("summarizeDashboardChanges", () => {
  it("keeps the first changes and counts the rest", () => {
    const changes = Array.from({ length: 11 }, (_, index) => ({
      kind: "panel-added" as const,
      title: `Panel ${index}`,
    }));
    const summary = summarizeDashboardChanges(changes);
    expect(summary.changes).toEqual(
      changes.slice(0, MAX_STORED_DASHBOARD_CHANGES),
    );
    expect(summary.omitted).toBe(11 - MAX_STORED_DASHBOARD_CHANGES);
    expect(summarizeDashboardChanges([{ kind: "other" }])).toEqual({
      changes: [{ kind: "other" }],
      omitted: 0,
    });
  });

  it("never stores an empty list for a write", () => {
    expect(summarizeDashboardChanges([])).toEqual({
      changes: [{ kind: "other" }],
      omitted: 0,
    });
  });
});

describe("parseDashboardChangeSummary", () => {
  it("round-trips a stored summary", () => {
    const summary = summarizeDashboardChanges(
      describeDashboardChanges(
        dashboard(),
        dashboard({ name: "Renamed", panels: [panel("dau")] }),
      ),
    );
    expect(parseDashboardChangeSummary(JSON.stringify(summary))).toEqual({
      status: "valid",
      summary,
    });
  });

  it("tells a missing summary apart from an unreadable one", () => {
    expect(parseDashboardChangeSummary(null)).toEqual({ status: "absent" });
    expect(parseDashboardChangeSummary(undefined)).toEqual({
      status: "absent",
    });
    for (const raw of [
      "not-json",
      "[]",
      42,
      JSON.stringify({ changes: [] }),
      JSON.stringify({ changes: [{ kind: "panel-exploded" }], omitted: 0 }),
      JSON.stringify({ changes: [{ kind: "panel-added" }], omitted: 0 }),
      JSON.stringify({
        changes: [
          { kind: "column-resized", title: "T", columns: 0, direction: null },
        ],
        omitted: 0,
      }),
      JSON.stringify({ changes: [{ kind: "other" }], omitted: -1 }),
      JSON.stringify({ changes: [], omitted: 0 }),
      JSON.stringify({ changes: [], omitted: 3 }),
    ]) {
      expect(parseDashboardChangeSummary(raw)).toEqual({
        status: "unreadable",
      });
    }
  });
});
