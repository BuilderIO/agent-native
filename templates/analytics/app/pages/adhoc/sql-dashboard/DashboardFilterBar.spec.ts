import { describe, expect, it } from "vitest";

import { resolveFilterVars } from "./DashboardFilterBar";
import { interpolate } from "./interpolate";
import type { DashboardFilter } from "./types";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const noParams = () => "";

describe("resolveFilterVars", () => {
  it("keeps a select default literal even when it looks like the Nd date shorthand", () => {
    // Regression: a `timeRange` select with default "90d" must resolve to the
    // literal option value "90d" — not a date. Expanding it to a date left the
    // dropdown blank and made every panel's `'{{timeRange}}' = '90d'` branch
    // false, so the whole dashboard showed "No data".
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

  it("keeps a text default literal", () => {
    const filters: DashboardFilter[] = [
      { id: "q", label: "Query", type: "text", default: "30d" },
    ];
    expect(resolveFilterVars(filters, noParams).q).toBe("30d");
  });
});
