import { describe, expect, it } from "vitest";

import { rankAnalyticsQueryCatalog } from "./analytics-query-catalog";

describe("analytics query catalog", () => {
  it("finds a saved signup chart and returns its source and query", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "how many agent-native signups yesterday",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "agent-native",
          title: "Agent Native Product",
          description: "Product adoption",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "total-signups",
                title: "Agent Native Signups",
                source: "first-party",
                sql: "SELECT COUNT(*) AS signups FROM analytics_events WHERE event_name = 'signup'",
                config: { description: "Signup events" },
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "dashboard-panel",
      origin: "saved-dashboard",
      dashboardId: "agent-native",
      panelId: "total-signups",
      source: "first-party",
    });
    expect(results[0]).toHaveProperty(
      "query",
      expect.stringContaining("analytics_events"),
    );
  });

  it("ranks an approved dictionary definition and preserves provider routing", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "closed won revenue",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "closed-won-revenue",
          metric: "Closed Won Revenue",
          definition: "Revenue from closed-won HubSpot deals",
          source: "hubspot",
          action: "hubspot-deals",
          approved: true,
        },
        {
          id: "revenue-notes",
          metric: "Revenue Notes",
          definition: "Unreviewed notes",
          aiGenerated: true,
          approved: false,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "closed-won-revenue",
      source: "hubspot",
      action: "hubspot-deals",
      approved: true,
    });
  });

  it("returns only the bounded number of strongest matches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "signup",
      limit: 1,
      dictionaryEntries: [
        {
          id: "signup",
          metric: "Signup",
          definition: "Canonical signup",
          approved: true,
        },
      ],
      dashboards: [
        {
          id: "secondary",
          title: "Secondary",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "signup",
                title: "Signup",
                source: "bigquery",
                sql: "SELECT 1",
              },
            ],
          },
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "signup",
    });
  });
});
