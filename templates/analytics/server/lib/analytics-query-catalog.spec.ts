import { describe, expect, it } from "vitest";

import { rankAnalyticsQueryCatalog } from "./analytics-query-catalog";
import { loadDashboardSeed } from "./dashboard-seeds";

describe("analytics query catalog", () => {
  it("finds the shipped Agent Native signup chart and returns its source and query", () => {
    const config = loadDashboardSeed("agent-native-templates-first-party");
    expect(config).not.toBeNull();
    const results = rankAnalyticsQueryCatalog({
      search: "how many agent-native signups yesterday",
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

  it("matches plural questions against singular saved titles", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "how many templates are in use",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "d1",
          title: "Adoption",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "template-usage",
                title: "Template Usage",
                source: "bigquery",
                sql: "SELECT template, COUNT(*) FROM installs GROUP BY 1",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({ panelId: "template-usage" });
  });

  it("finds a panel whose only match is inside its SQL", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "hubspot deals",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "d1",
          title: "Revenue",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "quarterly-bookings",
                title: "Quarterly Bookings",
                source: "bigquery",
                sql: "SELECT * FROM `p.mart.dim_hs_deals` WHERE stage = 'closedwon'",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({ panelId: "quarterly-bookings" });
  });

  it("surfaces extension panels that have no SQL", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "risk meeting",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "d1",
          title: "Risk Meeting",
          origin: "saved-dashboard",
          config: {
            panels: [
              { id: "risk-ext", title: "Risk Meeting", source: "extension" },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({ panelId: "risk-ext" });
    expect(results[0]).not.toHaveProperty("query");
  });

  it("keeps demo panels out of real data questions but allows them when asked", () => {
    const dashboards = [
      {
        id: "demo",
        title: "Node Exporter Full",
        origin: "saved-dashboard" as const,
        config: {
          panels: [
            {
              id: "demo-errors",
              title: "Error Rate",
              source: "demo",
              sql: "up",
            },
          ],
        },
      },
    ];

    expect(
      rankAnalyticsQueryCatalog({
        search: "error rate last 7 days",
        limit: 6,
        dictionaryEntries: [],
        dashboards,
      }),
    ).toHaveLength(0);

    expect(
      rankAnalyticsQueryCatalog({
        search: "demo error rate",
        limit: 6,
        dictionaryEntries: [],
        dashboards,
      })[0],
    ).toMatchObject({ panelId: "demo-errors" });
  });

  it("scores partial coverage of a long question instead of requiring every term", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "which enterprise accounts in the strategic segment renewed",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "d1",
          title: "Accounts",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "enterprise-accounts",
                title: "Enterprise Accounts",
                source: "hubspot",
                sql: "SELECT * FROM companies WHERE tier = 'enterprise'",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({ panelId: "enterprise-accounts" });
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("ranks a runnable panel above an equally-named one with no SQL", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "enterprise accounts",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "d1",
          title: "Accounts",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "ext-panel",
                title: "Enterprise Accounts",
                source: "extension",
              },
              {
                id: "sql-panel",
                title: "Enterprise Accounts",
                source: "bigquery",
                sql: "SELECT name FROM companies WHERE tier = 'enterprise'",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({ panelId: "sql-panel" });
  });

  it("collapses identical panels cloned across dashboards", () => {
    const panel = {
      id: "strategic",
      title: "Strategic Accounts",
      source: "bigquery",
      sql: "SELECT * FROM accounts WHERE segment = 'strategic'",
    };
    const results = rankAnalyticsQueryCatalog({
      search: "strategic accounts",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [1, 2, 3].map((n) => ({
        id: `clone-${n}`,
        title: `Clone ${n}`,
        origin: "saved-dashboard" as const,
        config: { panels: [panel] },
      })),
    });

    expect(results).toHaveLength(1);
  });

  it("does not let generic single-token matches tie above an exact panel", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "error rate",
      limit: 6,
      dashboards: [
        {
          id: "d1",
          title: "Reliability",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "5xx-rate",
                title: "5xx Error Rate",
                source: "bigquery",
                sql: "SELECT status, COUNT(*) FROM requests GROUP BY 1",
              },
            ],
          },
        },
      ],
      dictionaryEntries: [
        { id: "churn", metric: "Monthly Churn Rate", approved: true },
        { id: "poc", metric: "POC Success Rate", approved: true },
        { id: "trial", metric: "Trial Retention Rate", approved: true },
      ],
    });

    expect(results[0]).toMatchObject({ panelId: "5xx-rate" });
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
