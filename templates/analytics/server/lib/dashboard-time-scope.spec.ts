import { describe, expect, it } from "vitest";

import { validateFirstPartyDashboardTimeScope } from "./dashboard-time-scope";

function panel(overrides: Record<string, unknown> = {}) {
  return {
    id: "panel",
    title: "Panel",
    source: "first-party",
    chartType: "metric",
    sql: "SELECT COUNT(*) AS value FROM analytics_events",
    ...overrides,
  };
}

describe("first-party dashboard time scope", () => {
  it("accepts a dashboard-bound panel with a non-empty default", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "SELECT COUNT(*) FROM analytics_events WHERE event_date >= '{{timeRange}}'",
        }),
        {
          filters: [
            {
              id: "timeRange",
              type: "select",
              default: "90d",
            },
          ],
        },
        0,
      ),
    ).toBeNull();
  });

  it("rejects a time placeholder without its matching filter", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "SELECT COUNT(*) FROM analytics_events WHERE event_date >= '{{timeRange}}'",
        }),
        { filters: [] },
        0,
      ),
    ).toMatch(/no matching "timeRange" filter/);
  });

  it("rejects an unbounded ad-hoc first-party panel", () => {
    expect(
      validateFirstPartyDashboardTimeScope(panel(), { filters: [] }, 0),
    ).toMatch(/without a time bound/);
  });

  it("allows an explicitly labeled all-time exception", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          title: "Lifetime signups",
          config: {
            timeScope: "all-time",
            description: "Lifetime total across all historical signups.",
          },
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("requires intent to be visible for all-time exceptions", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({ config: { timeScope: "all-time" } }),
        { filters: [] },
        0,
      ),
    ).toMatch(/description or title.*lifetime/);
  });

  it("keeps accepting bounded fixed-window catalog SQL", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "SELECT COUNT(*) FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')",
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("allows cohort-history panels to scan history intentionally", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          config: { timeScope: "cohort-history" },
          sql: "WITH first_seen AS (SELECT user_id, MIN(event_date) AS cohort_date FROM analytics_events GROUP BY user_id) SELECT COUNT(*) FROM first_seen",
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("rejects an unbounded analytics scan in the outer query after a bounded CTE", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH bounded AS (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days') SELECT COUNT(*) FROM analytics_events",
        }),
        { filters: [] },
        0,
      ),
    ).toMatch(/at least one analytics_events read/);
  });

  it("parses recursive CTEs when checking their analytics bounds", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH RECURSIVE bounded AS (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days') SELECT COUNT(*) FROM bounded",
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("parses CTE column lists when checking their analytics bounds", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH bounded(day) AS (SELECT event_date FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days') SELECT COUNT(*) FROM bounded",
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("parses quoted CTE identifiers when checking their analytics bounds", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: 'WITH "recent events" AS (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL \'30 days\') SELECT COUNT(*) FROM "recent events"',
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("ignores parentheses inside quoted CTE text", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH unbounded AS (SELECT 'literal ) still in this CTE' AS label FROM analytics_events), recent AS (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days') SELECT COUNT(*) FROM recent",
        }),
        { filters: [] },
        0,
      ),
    ).toMatch(/at least one analytics_events read/);
  });

  it("fails closed when one CTE contains multiple analytics scans", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH mixed AS (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days' UNION ALL SELECT * FROM analytics_events) SELECT COUNT(*) FROM mixed",
        }),
        { filters: [] },
        0,
      ),
    ).toMatch(/at least one analytics_events read/);
  });

  it("parses materialized CTE modifiers", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH bounded AS NOT MATERIALIZED (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days') SELECT COUNT(*) FROM bounded",
        }),
        { filters: [] },
        0,
      ),
    ).toBeNull();
  });

  it("skips comments between CTE declarations", () => {
    expect(
      validateFirstPartyDashboardTimeScope(
        panel({
          sql: "WITH bounded AS (SELECT * FROM analytics_events WHERE event_date >= CURRENT_DATE - INTERVAL '30 days'), /* another CTE follows */ unbounded AS (SELECT * FROM analytics_events) SELECT COUNT(*) FROM bounded",
        }),
        { filters: [] },
        0,
      ),
    ).toMatch(/at least one analytics_events read/);
  });
});
