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
});
