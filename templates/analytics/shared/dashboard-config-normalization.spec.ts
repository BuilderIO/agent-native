import { describe, expect, it } from "vitest";

import { normalizeDashboardConfig } from "./dashboard-config-normalization";

describe("normalizeDashboardConfig", () => {
  it("repairs panel fields nested under config without moving renderer options", () => {
    const config = {
      name: "Overlap",
      panels: [
        {
          id: "overlap",
          title: "Old title",
          sql: "SELECT 0 AS value",
          source: "first-party",
          chartType: "metric",
          width: 1,
          config: {
            title: "Overlap Users Active in Agent-Native (7d / 30d)",
            sql: "SELECT activity_window, overlap_users FROM overlap_users",
            source: "bigquery",
            chartType: "table",
            width: 2,
            tab: "Adoption",
            columns: [{ key: "activity_window" }],
          },
        },
      ],
    };

    const normalized = normalizeDashboardConfig(config);
    const panels = normalized.panels as Array<Record<string, unknown>>;
    const panel = panels[0]!;

    expect(panel).toMatchObject({
      title: "Overlap Users Active in Agent-Native (7d / 30d)",
      sql: "SELECT activity_window, overlap_users FROM overlap_users",
      source: "bigquery",
      chartType: "table",
      width: 2,
      tab: "Adoption",
      config: { columns: [{ key: "activity_window" }] },
    });
    expect(panel.config).not.toHaveProperty("sql");
    expect(panel.config).not.toHaveProperty("chartType");
    expect(panel.config).not.toHaveProperty("title");
  });

  it("promotes nested values over the stale top-level values", () => {
    const normalized = normalizeDashboardConfig({
      name: "Traffic",
      panels: [
        {
          id: "panel",
          config: { sql: "SELECT 1", chartType: "table", width: 2 },
        },
      ],
    });

    expect(normalized.panels).toEqual([
      { id: "panel", sql: "SELECT 1", chartType: "table", width: 2 },
    ]);
  });

  it("returns the original config when no panel fields are misplaced", () => {
    const config = {
      name: "Traffic",
      panels: [{ id: "panel", config: { columns: [{ key: "path" }] } }],
    };

    expect(normalizeDashboardConfig(config)).toBe(config);
  });
});
