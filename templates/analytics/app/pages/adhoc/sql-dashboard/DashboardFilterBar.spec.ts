import { describe, expect, it } from "vitest";

import { resolveFilterVars } from "./DashboardFilterBar";
import { interpolate, interpolateDashboardPanelSql } from "./interpolate";
import type { DashboardFilter } from "./types";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const noParams = () => "";

describe("resolveFilterVars", () => {
  it("keeps a select default literal even when it looks like the Nd date shorthand", () => {
    const filters: DashboardFilter[] = [
      {
        id: "timeRange",
        label: "Time range",
        type: "select",
        default: "90d",
        options: [
          { value: "90d", label: "Last 90 days" },
          { value: "all", label: "All time" },
        ],
      },
    ];
    expect(resolveFilterVars(filters, noParams).timeRange).toBe("90d");
  });

  it("keeps select defaults literal for the other Nd-shaped option values", () => {
    for (const value of ["7d", "30d", "180d", "365d"]) {
      const filters: DashboardFilter[] = [
        { id: "range", label: "Range", type: "select", default: value },
      ];
      expect(resolveFilterVars(filters, noParams).range).toBe(value);
    }
  });

  it("prefers an explicit URL param over the default", () => {
    const filters: DashboardFilter[] = [
      { id: "timeRange", label: "Time range", type: "select", default: "90d" },
    ];
    const getParam = (key: string) => (key === "timeRange" ? "30d" : "");
    expect(resolveFilterVars(filters, getParam).timeRange).toBe("30d");
  });

  it("normalizes the legacy all-time sentinel for date-range filters", () => {
    const filters: DashboardFilter[] = [
      { id: "window", label: "Window", type: "date-range", default: "30d" },
    ];
    const getParam = (key: string) =>
      key === "windowStart" || key === "windowEnd" ? "all" : "";

    const vars = resolveFilterVars(filters, getParam);
    expect(vars.windowStart).toBe("1970-01-01");
    expect(vars.windowEnd).toBe(daysAgo(0));
    expect(interpolate("TIMESTAMP('{{windowStart}}')", vars)).toBe(
      "TIMESTAMP('1970-01-01')",
    );
  });

  it("fails closed when a time variable is missing at render time", () => {
    expect(
      interpolate(
        "'{{timeRange}}' IN ('', 'all')",
        {},
        {
          failClosedTimeVariables: true,
        },
      ),
    ).toBe("'__missing_dashboard_time_filter__' IN ('', 'all')");
  });

  it("applies custom bounds to the BigQuery preset predicate", () => {
    const sql = interpolateDashboardPanelSql(
      "SELECT * FROM events WHERE ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '365d' AND e.event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)))",
      {
        timeRange: "custom",
        timeRangeStart: "2026-08-01",
        timeRangeEnd: "2026-08-15",
      },
      { source: "bigquery" },
    );

    expect(sql).toContain(
      "('custom' IN ('', 'all') OR ('custom' = '365d' AND e.event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)) OR ('custom' = 'custom' AND e.event_date >= DATE('2026-08-01') AND e.event_date <= DATE('2026-08-15')))",
    );
  });

  it("applies custom bounds to repeated Postgres cohort predicates", () => {
    const sql = interpolate(
      "SELECT * FROM events WHERE ((('{{timeRange}}' = '365d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) OR (('{{timeRange}}' = '365d' AND b.event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))))",
      {
        timeRange: "custom",
        timeRangeStart: "2026-08-01",
        timeRangeEnd: "2026-08-15",
      },
      { customDateRangeSupport: true },
    );

    expect(sql.match(/'custom' = 'custom'/g)).toHaveLength(2);
    expect(sql).toContain(
      "cohort_date >= to_char('2026-08-01'::date, 'YYYY-MM-DD') AND cohort_date <= to_char('2026-08-15'::date, 'YYYY-MM-DD')",
    );
    expect(sql).toContain(
      "b.event_date >= to_char('2026-08-01'::date, 'YYYY-MM-DD') AND b.event_date <= to_char('2026-08-15'::date, 'YYYY-MM-DD')",
    );
  });

  it("uses the custom end date for generated date spines", () => {
    const sql = interpolate(
      "WITH signups AS (SELECT event_date FROM events WHERE ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '365d' AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)))), bounds AS (SELECT COALESCE(MIN(event_date), CASE WHEN '{{timeRange}}' = '7d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) END) AS start_date FROM signups), dates AS (SELECT date FROM bounds, UNNEST(GENERATE_DATE_ARRAY(start_date, CURRENT_DATE())) AS date)",
      {
        timeRange: "custom",
        timeRangeStart: "2026-08-01",
        timeRangeEnd: "2026-08-15",
      },
      { customDateRangeSupport: true },
    );

    expect(sql).toContain("WHEN 'custom' = 'custom' THEN DATE('2026-08-01')");
    expect(sql).toContain(
      "UNNEST(GENERATE_DATE_ARRAY(start_date, IF('custom' = 'custom', LEAST(DATE('2026-08-15'), CURRENT_DATE()), CURRENT_DATE())))",
    );
  });

  it("fails closed for custom ranges without a supported SQL predicate", () => {
    expect(
      interpolate(
        "SELECT CASE '{{timeRange}}' WHEN '7d' THEN 7 ELSE 90 END",
        {
          timeRange: "custom",
          timeRangeStart: "2026-08-01",
          timeRangeEnd: "2026-08-15",
        },
        { customDateRangeSupport: true },
      ),
    ).toBe("SELECT __unsupported_custom_date_range__");
  });

  it("keeps explicit date values and date shorthands valid", () => {
    const filters: DashboardFilter[] = [
      { id: "window", label: "Window", type: "date-range", default: "30d" },
    ];
    const getParam = (key: string) =>
      ({ windowStart: "7d", windowEnd: "2026-07-12" })[key] ?? "";

    const vars = resolveFilterVars(filters, getParam);
    expect(vars.windowStart).toBe(daysAgo(7));
    expect(vars.windowEnd).toBe("2026-07-12");
  });

  it("keeps all as a literal for select filters", () => {
    const filters: DashboardFilter[] = [
      {
        id: "timeRange",
        label: "Time range",
        type: "select",
        default: "90d",
        options: [{ value: "all", label: "All time" }],
      },
    ];
    const getParam = (key: string) => (key === "timeRange" ? "all" : "");

    expect(resolveFilterVars(filters, getParam).timeRange).toBe("all");
  });

  it("still expands the Nd shorthand for date filters", () => {
    const filters: DashboardFilter[] = [
      { id: "since", label: "Since", type: "date", default: "30d" },
    ];
    expect(resolveFilterVars(filters, noParams).since).toBe(daysAgo(30));
  });

  it("expands the Nd shorthand for a date-range start and defaults the end to today", () => {
    const filters: DashboardFilter[] = [
      { id: "window", label: "Window", type: "date-range", default: "7d" },
    ];
    const vars = resolveFilterVars(filters, noParams);
    expect(vars.windowStart).toBe(daysAgo(7));
    expect(vars.windowEnd).toBe(daysAgo(0));
  });

  it("does not replace invalid explicit date-range bounds with defaults", () => {
    const filters: DashboardFilter[] = [
      { id: "window", label: "Window", type: "date-range", default: "7d" },
    ];
    const params: Record<string, string> = {
      windowStart: "2026-02-31",
      windowEnd: "2026-02-31",
    };
    const vars = resolveFilterVars(filters, (key) => params[key] || "");

    expect(vars.windowStart).toBe("");
    expect(vars.windowEnd).toBe("");
    expect(
      interpolateDashboardPanelSql(
        "SELECT * FROM events WHERE event_date BETWEEN DATE('{{windowStart}}') AND DATE('{{windowEnd}}')",
        vars,
        { source: "bigquery" },
      ),
    ).toContain("__missing_dashboard_time_filter__");
  });

  it("resolves custom bounds for a preset date filter", () => {
    const filters: DashboardFilter[] = [
      {
        id: "timeRange",
        label: "Time range",
        type: "select",
        default: "90d",
        options: [
          { value: "30d", label: "Last 30 days" },
          { value: "90d", label: "Last 90 days" },
          { value: "all", label: "All time" },
        ],
      },
    ];
    const params: Record<string, string> = {
      timeRange: "custom",
      timeRangeStart: "2026-08-01",
      timeRangeEnd: "2026-08-15",
    };

    const vars = resolveFilterVars(filters, (key) => params[key] || "");
    expect(vars).toMatchObject(params);

    params.timeRangeStart = "2026-02-31";
    params.timeRangeEnd = "2026-02-31";
    const invalid = resolveFilterVars(filters, (key) => params[key] || "");
    expect(invalid.timeRangeStart).toBe("");
    expect(invalid.timeRangeEnd).toBe("");
    expect(
      interpolateDashboardPanelSql(
        "SELECT * FROM events WHERE '{{timeRange}}' = 'custom'",
        invalid,
        { source: "bigquery" },
      ),
    ).toBe("SELECT __invalid_custom_date_range__");
  });

  it("fails closed for reversed custom date ranges", () => {
    expect(
      interpolateDashboardPanelSql(
        "SELECT * FROM events WHERE '{{timeRange}}' = 'custom'",
        {
          timeRange: "custom",
          timeRangeStart: "2026-08-15",
          timeRangeEnd: "2026-08-01",
        },
        { source: "bigquery" },
      ),
    ).toBe("SELECT __invalid_custom_date_range__");
  });

  it("keeps fixed-window panel queries outside custom range rewriting", () => {
    const sql = interpolateDashboardPanelSql(
      "SELECT * FROM events WHERE '{{timeRange}}' = '365d'",
      {
        timeRange: "custom",
        timeRangeStart: "2026-08-01",
        timeRangeEnd: "2026-08-15",
      },
      { source: "bigquery", config: { timeScope: "fixed-window" } },
    );

    expect(sql).toBe("SELECT * FROM events WHERE 'custom' = '365d'");
  });

  it("keeps a text default literal", () => {
    const filters: DashboardFilter[] = [
      { id: "q", label: "Query", type: "text", default: "30d" },
    ];
    expect(resolveFilterVars(filters, noParams).q).toBe("30d");
  });
});
