import { describe, expect, it } from "vitest";

import { interpolateDashboardPanelSql } from "../app/pages/adhoc/sql-dashboard/interpolate";
import {
  breakdownRowDimensions,
  buildBreakdownTable,
  isValidPanelBreakdowns,
  planBreakdown,
  rowsForBreakdown,
} from "./row-breakdown";

const PANEL_SQL = `SELECT role{{?breakdown}}, {{breakdown}}{{/breakdown}}, COUNT(*) AS people
FROM cohort
WHERE signup_date >= '{{timeRangeStart}}'
GROUP BY role{{?breakdown}}, {{breakdown}}{{/breakdown}}`;

describe("planBreakdown", () => {
  it("reuses the panel's rows when they already carry the column", () => {
    expect(
      planBreakdown({
        column: "app",
        panelRows: [{ role: "Engineer", app: "Builder", people: 40 }],
        panelSql: "SELECT role, app, COUNT(*) AS people FROM t GROUP BY 1, 2",
        vars: {},
      }),
    ).toEqual({ kind: "reuse" });
  });

  it("turns on the breakdown block with the dashboard's own filters", () => {
    const plan = planBreakdown({
      column: "app",
      panelRows: [{ role: "Engineer", people: 40 }],
      panelSql: PANEL_SQL,
      vars: {
        timeRange: "custom",
        timeRangeStart: "2026-09-01",
        timeRangeEnd: "2026-09-30",
      },
    });
    expect(plan).toEqual({
      kind: "query",
      vars: {
        timeRange: "custom",
        timeRangeStart: "2026-09-01",
        timeRangeEnd: "2026-09-30",
        breakdown: "app",
      },
    });
    if (plan.kind !== "query") throw new Error("expected a query plan");
    const sql = interpolateDashboardPanelSql(PANEL_SQL, plan.vars, {
      source: "bigquery",
    });
    expect(sql).toContain("SELECT role, app, COUNT(*)");
    expect(sql).toContain("GROUP BY role, app");
    expect(sql).toContain("'2026-09-01'");
  });

  it("leaves the panel's normal SQL unchanged", () => {
    const sql = interpolateDashboardPanelSql(
      PANEL_SQL,
      {
        timeRange: "custom",
        timeRangeStart: "2026-09-01",
        timeRangeEnd: "2026-09-30",
      },
      { source: "bigquery" },
    );
    expect(sql).toContain("SELECT role, COUNT(*)");
    expect(sql).toMatch(/GROUP BY role$/);
    expect(sql).not.toContain("app");
  });

  it("is unavailable when the SQL has no block and the rows lack the column", () => {
    expect(
      planBreakdown({
        column: "app",
        panelRows: [{ role: "Engineer", people: 40 }],
        panelSql: "SELECT role, COUNT(*) AS people FROM t GROUP BY 1",
        vars: {},
      }),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("isValidPanelBreakdowns", () => {
  it("accepts identifiers and rejects SQL, repeats and empty lists", () => {
    expect(isValidPanelBreakdowns([{ column: "app", label: "App" }])).toBe(
      true,
    );
    expect(isValidPanelBreakdowns([])).toBe(false);
    expect(isValidPanelBreakdowns([{ column: "app; DROP" }])).toBe(false);
    expect(isValidPanelBreakdowns([{ column: "app" }, { column: "app" }])).toBe(
      false,
    );
    expect(isValidPanelBreakdowns([{ column: "app", extra: 1 }])).toBe(false);
  });
});

describe("breakdownRowDimensions", () => {
  it("names a row by every non-numeric column but the breakdown's", () => {
    expect(
      breakdownRowDimensions(
        [
          { key: "people", format: "number" },
          { key: "role" },
          { key: "rate", format: "percent" },
        ],
        {
          role: "Engineer",
          team: "Core",
          app: "Builder",
          people: 40,
          rate: 0.5,
        },
        "app",
      ),
    ).toEqual(["role", "team"]);
  });

  it("treats unformatted numbers, including numeric strings, as measures", () => {
    expect(
      breakdownRowDimensions(undefined, { role: "PM", people: "40" }, "app"),
    ).toEqual(["role"]);
  });

  it("keeps rows that share one value apart by the others", () => {
    const rows = [
      { role: "Engineer", team: "Core", app: "Builder", people: 30 },
      { role: "Engineer", team: "Growth", app: "Builder", people: 20 },
    ];
    expect(
      rowsForBreakdown(rows, ["role", "team"], {
        role: "Engineer",
        team: "Growth",
        people: 20,
      }),
    ).toEqual([rows[1]]);
  });
});

describe("buildBreakdownTable", () => {
  const rows = rowsForBreakdown(
    [
      { role: "Engineer", app: "Builder", people: 60 },
      { role: "Engineer", app: "Clips", people: 12 },
      { role: "Engineer", app: "Mail", people: 3 },
      { role: "Designer", app: "Builder", people: 50 },
    ],
    ["role"],
    { role: "Engineer", people: 80 },
  );

  it("orders groups, mutes small ones, and folds tiny ones into Other", () => {
    const table = buildBreakdownTable({
      rows,
      column: "app",
      sizeKey: "people",
      parentSize: 80,
    });
    expect(table.groups.map((group) => [group.value, group.small])).toEqual([
      ["Builder", false],
      ["Clips", true],
    ]);
    // Mail's 3 plus 5 people the panel SQL left out of every listed group.
    expect(table.other).toEqual({ size: 8, groupCount: 1 });
  });

  it("has no Other row when the groups account for everyone", () => {
    const table = buildBreakdownTable({
      rows: rows.slice(0, 2),
      column: "app",
      sizeKey: "people",
      parentSize: 72,
    });
    expect(table.other).toBeNull();
  });
});
