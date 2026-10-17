import { describe, expect, it } from "vitest";

import { validateFirstPartyDashboardTimeScope } from "./dashboard-time-scope";
import {
  UNBOUNDED_FIRST_PARTY_PANEL_FIXES,
  repairUnboundedFirstPartyPanels,
} from "./first-party-unbounded-panel-repair";

describe("repairUnboundedFirstPartyPanels", () => {
  it("rewrites a matching first-party panel's SQL and leaves everything else untouched", () => {
    const [{ legacySql, sql: fixedSql }] = UNBOUNDED_FIRST_PARTY_PANEL_FIXES;
    const config = {
      name: "Some Dashboard",
      panels: [
        { id: "kept", source: "bigquery", sql: "SELECT 1" },
        {
          id: "broken",
          title: "Broken panel",
          source: "first-party",
          chartType: "line",
          width: 2,
          sql: legacySql,
        },
      ],
    };

    const result = repairUnboundedFirstPartyPanels(config);

    expect(result.changed).toBe(true);
    const panels = result.config.panels as Record<string, unknown>[];
    expect(panels[0]).toEqual(config.panels[0]);
    expect(panels[1]).toMatchObject({ id: "broken", sql: fixedSql });
  });

  it("is a no-op when no panel SQL matches a known-unbounded pattern", () => {
    const config = {
      panels: [{ id: "fine", source: "first-party", sql: "SELECT 1 AS one" }],
    };
    const result = repairUnboundedFirstPartyPanels(config);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });

  it("ignores non-first-party panels even if their SQL text happens to match", () => {
    const [{ legacySql }] = UNBOUNDED_FIRST_PARTY_PANEL_FIXES;
    const config = {
      panels: [{ id: "p", source: "bigquery", sql: legacySql }],
    };
    const result = repairUnboundedFirstPartyPanels(config);
    expect(result.changed).toBe(false);
  });

  it("groups a saved raw-app sessions panel by the template key, bounded or not", () => {
    const sessionFixes = UNBOUNDED_FIRST_PARTY_PANEL_FIXES.filter((fix) =>
      fix.legacySql.startsWith(
        "SELECT COALESCE(NULLIF(app, ''), 'unknown') AS app",
      ),
    );

    expect(sessionFixes).toHaveLength(2);
    for (const fix of sessionFixes) {
      expect(
        fix.sql.startsWith("SELECT lower(COALESCE(NULLIF(template, '')"),
      ).toBe(true);
      expect(fix.sql).toContain("GROUP BY lower(COALESCE(NULLIF(template, '')");
      const { config } = repairUnboundedFirstPartyPanels({
        panels: [{ id: "s", source: "first-party", sql: fix.legacySql }],
      });
      expect((config.panels as Array<{ sql: string }>)[0].sql).toBe(fix.sql);
    }
  });

  it("every fixed replacement passes the strengthened per-scan-unit time-scope guard", () => {
    for (const { sql } of UNBOUNDED_FIRST_PARTY_PANEL_FIXES) {
      const panel = { source: "first-party", sql, config: {} };
      const dashboard = {
        filters: [
          {
            id: "timeRange",
            type: "select",
            default: "90d",
          },
          {
            id: "date",
            type: "date-range",
            default: "90d",
          },
          {
            id: "emailFilter",
            type: "select",
            default: "exclude_builder",
          },
        ],
      };
      expect(
        validateFirstPartyDashboardTimeScope(panel, dashboard, 0),
      ).toBeNull();
    }
  });
});
