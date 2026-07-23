import { describe, expect, it } from "vitest";

import { rankAnalyticsQueryCatalog } from "./analytics-query-catalog";
import { loadDashboardSeed } from "./dashboard-seeds";

describe("analytics query catalog", () => {
  it("finds the shipped Agent Native signup chart and returns its source and query", () => {
    const config = loadDashboardSeed("agent-native-templates-first-party");
    expect(config).not.toBeNull();
    const results = rankAnalyticsQueryCatalog({
      search: "total signups",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "agent-native-templates-first-party",
          title: "Agent Native Templates (First-party)",
          description: "Product adoption",
          origin: "dashboard-template",
          config: config!,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "dashboard-panel",
      origin: "dashboard-template",
      dashboardId: "agent-native-templates-first-party",
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
