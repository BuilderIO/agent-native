import { describe, expect, it } from "vitest";

import {
  rankAnalyticsQueryCatalog,
  relevanceTerms,
  searchTerms,
} from "./analytics-query-catalog";
import { loadDashboardSeed } from "./dashboard-seeds";

describe("analytics query catalog", () => {
  it("finds the shipped Agent-Native signup chart and returns its source and query", () => {
    const config = loadDashboardSeed("agent-native-templates-first-party");
    expect(config).not.toBeNull();
    const results = rankAnalyticsQueryCatalog({
      search: "how many agent-native signups yesterday",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "agent-native-templates-first-party",
          title: "Agent-Native Templates (First-party)",
          description: "Product adoption",
          origin: "dashboard-template",
          config: config!,
        },
      ],
    });

    const signupResult = results.find(
      (result) =>
        result.kind === "dashboard-panel" && result.panelId === "total-signups",
    );
    expect(signupResult).toMatchObject({
      kind: "dashboard-panel",
      origin: "dashboard-template",
      dashboardId: "agent-native-templates-first-party",
      panelId: "total-signups",
      source: "first-party",
    });
    expect(signupResult).toHaveProperty(
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
    expect(
      results.some(
        (result) =>
          result.kind === "data-dictionary" && result.id === "revenue-notes",
      ),
    ).toBe(false);
  });

  it("keeps approved definitions ahead of broader generated source-index matches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "Builder.io product monthly active user count",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "generated-builder-users",
          metric: "Builder.io product monthly active user count",
          definition: "Generated model metadata for monthly active users",
          table: "product_user_dimension",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
        {
          id: "approved-builder-users",
          metric: "Builder.io user count",
          definition: "Reviewed definition for Builder.io user count",
          table: "product_user_dimension",
          approved: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "approved-builder-users",
      approved: true,
    });
  });

  it("ranks dbt grain metadata ahead of Sigma examples", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "workspace user grain",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "sigma-user-grain-example",
          metric: "Workspace User Grain Example",
          definition:
            "Reviewed dashboard example for workspace users and grain.",
          table: "workspace_user_rollup",
          semanticScope: "membership",
          sourceKind: "sigma",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
        {
          id: "dbt-workspace-user-grain",
          metric: "model:workspace_user_rollup",
          definition: "One row per workspace user, with the canonical grain.",
          table: "workspace_user_rollup",
          semanticScope: "session",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "dbt-workspace-user-grain",
      sourceKind: "dbt",
    });
  });

  it("uses one transitive trust and scope order across catalog kinds", () => {
    const dashboards = [
      {
        id: "favorite-user-count",
        title: "User count",
        origin: "saved-dashboard" as const,
        favorite: true,
        certification: {
          status: "certified" as const,
          certifiedAt: "2026-10-01T00:00:00.000Z",
          certifiedBy: "reviewer@example.com",
          certifiedForUpdatedAt: "v1",
        },
        updatedAt: "v1",
        config: {
          panels: [
            {
              id: "user-count",
              title: "User count",
              source: "bigquery",
              sql: "SELECT user_id FROM user_dimension",
            },
          ],
        },
      },
    ];
    const dictionaryEntries = [
      {
        id: "approved-organization-users",
        metric: "Builder product user count",
        definition: "Approved organization user definition",
        semanticScope: "organization",
        approved: true,
      },
      {
        id: "sigma-product-users",
        metric: "Builder product user count",
        definition: "Generated product user example",
        semanticScope: "product_user",
        sourceKind: "sigma",
        sourceIndex: true,
        approved: false,
        aiGenerated: true,
      },
    ];
    const rank = (entries: typeof dictionaryEntries) =>
      rankAnalyticsQueryCatalog({
        search: "Builder product user count",
        limit: 6,
        dashboards,
        dictionaryEntries: entries,
      }).map((candidate) =>
        candidate.kind === "data-dictionary"
          ? candidate.id
          : candidate.dashboardId,
      );

    const expected = [
      "approved-organization-users",
      "favorite-user-count",
      "sigma-product-users",
    ];
    expect(rank(dictionaryEntries)).toEqual(expected);
    expect(rank([...dictionaryEntries].reverse())).toEqual(expected);
  });

  it("keeps Builder product users ahead of feature funnels and Analytics users", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "Builder.io users",
      limit: 6,
      dictionaryEntries: [
        {
          id: "builder-users",
          metric: "model:product_user_dimension",
          definition: "Canonical product user records",
          table: "product_user_dimension",
          semanticScope: "product_user",
          aiGenerated: true,
          approved: false,
        },
        {
          id: "analytics-users",
          metric: "model:analytics_app_users",
          definition: "Users of the analytics application",
          table: "analytics_app_users",
          semanticScope: "analytics_user",
          aiGenerated: true,
          approved: false,
        },
      ],
      dashboards: [
        {
          id: "activation-funnel",
          title: "Product Activation Funnel",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "activation-events",
                title: "Product Activation events",
                source: "bigquery",
                sql: "SELECT user_id, event_name FROM synthetic_feature_events",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "builder-users",
      semanticScope: "product_user",
    });
    expect(
      results.some((candidate) => candidate.kind === "dashboard-panel"),
    ).toBe(false);
    expect(
      results.some(
        (candidate) =>
          candidate.kind === "data-dictionary" &&
          candidate.id === "analytics-users",
      ),
    ).toBe(false);
  });

  it("ranks organization membership over Builder.io Connect user dashboards", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "Builder.io users organization",
      limit: 6,
      dictionaryEntries: [
        {
          id: "builder-users-by-organization",
          metric: "Builder.io User Distribution by Organization",
          definition:
            "Distribution of Builder.io product users across organizations, one row per user and organization membership.",
          table: "dbt_intermediate.user_organization_role",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          aiGenerated: true,
          approved: false,
        },
      ],
      dashboards: [
        {
          id: "builder-connect",
          title: "Builder.io Connect",
          origin: "saved-dashboard",
          favorite: true,
          config: {
            panels: [
              {
                id: "connect-funnel",
                title: "Builder.io Connect Users",
                config: {
                  description:
                    "Distinct users through Builder.io Connect clicked, started, and succeeded.",
                },
                source: "bigquery",
                sql: "SELECT org_id, user_id, event_name FROM builder_connect_events",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "builder-users-by-organization",
      semanticScope: "membership",
    });
  });

  it("penalizes off-topic terms in metric names when query coverage is equal", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "organization Builder.io users",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "membership-distribution",
          metric: "Builder.io User Distribution by Organization",
          definition: "Builder.io users organization membership records.",
          table: "user_organization_role",
          semanticScope: "membership",
          sourceKind: "sigma",
          sourceIndex: true,
          aiGenerated: true,
          approved: false,
        },
        {
          id: "connect-membership",
          metric: "Builder.io Users Organization Connect",
          definition: "Builder.io users organization membership records.",
          table: "user_organization_role",
          semanticScope: "membership",
          sourceKind: "sigma",
          sourceIndex: true,
          aiGenerated: true,
          approved: false,
        },
      ],
    });

    expect(
      results.map((candidate) =>
        candidate.kind === "data-dictionary" ? candidate.id : candidate.panelId,
      ),
    ).toEqual(["membership-distribution", "connect-membership"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].exactMatchedTerms).toHaveLength(4);
    expect(results[1].exactMatchedTerms).toHaveLength(4);
  });

  it("keeps a relevant AI generated definition when human entries are unrelated", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly active users",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "unrelated-human-entry",
          metric: "Closed Won Revenue",
          definition: "Revenue from closed-won deals",
          approved: true,
        },
        {
          id: "active-users-suggestion",
          metric: "Monthly Active Users",
          definition: "Distinct users with activity this month",
          aiGenerated: true,
          approved: false,
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "active-users-suggestion",
        aiGenerated: true,
        approved: false,
      }),
    );
  });

  it("keeps a stronger AI definition when a human entry only weakly matches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly active users",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "weak-human-monthly-revenue",
          metric: "Monthly Revenue",
          definition: "Revenue from closed-won deals",
          approved: true,
        },
        {
          id: "strong-active-users-suggestion",
          metric: "Monthly Active Users",
          definition: "Distinct users with activity this month",
          aiGenerated: true,
          approved: false,
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "strong-active-users-suggestion",
        aiGenerated: true,
        approved: false,
      }),
    );
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

  it("does not return explicitly retired catalog references", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "account usage",
      limit: 6,
      dashboards: [
        {
          id: "retired-dashboard",
          title: "Account Usage",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "retired-panel",
                title: "Account Usage",
                source: "bigquery",
                status: "deprecated",
                sql: "SELECT * FROM current_usage",
              },
            ],
          },
        },
      ],
      dictionaryEntries: [
        {
          id: "retired-metric",
          metric: "Account Usage",
          table: "account_usage",
          queryTemplate: "SELECT * FROM account_usage",
          lifecycle: "retired",
          approved: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("boosts only a dashboard certified for its current version", () => {
    const certification = {
      status: "certified" as const,
      certifiedAt: "2026-08-28T00:00:00.000Z",
      certifiedBy: "admin@example.com",
      certifiedForUpdatedAt: "v1",
    };
    const panel = {
      id: "signups",
      title: "Signups",
      source: "first-party",
      sql: "SELECT COUNT(*) AS signups FROM analytics_events",
    };
    const results = rankAnalyticsQueryCatalog({
      search: "signups",
      limit: 2,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "stale",
          title: "Stale dashboard",
          origin: "saved-dashboard",
          config: {
            panels: [{ ...panel, title: "Signups (stale copy)" }],
          },
          certification,
          updatedAt: "v2",
        },
        {
          id: "current",
          title: "Current dashboard",
          origin: "saved-dashboard",
          config: { panels: [panel] },
          certification,
          updatedAt: "v1",
          favorite: true,
        },
      ],
    });
    expect(results[0]).toMatchObject({
      dashboardId: "current",
      dashboardCertified: true,
      favorite: true,
    });
    expect(results[1]).toMatchObject({
      dashboardId: "stale",
      dashboardCertified: false,
    });
  });

  it("requires relevance before applying certification or favorite signals", () => {
    const certification = {
      status: "certified" as const,
      certifiedAt: "2026-08-28T00:00:00.000Z",
      certifiedBy: "admin@example.com",
      certifiedForUpdatedAt: "v1",
    };
    const results = rankAnalyticsQueryCatalog({
      search: "revenue",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "signups",
          title: "Signups",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "signups",
                title: "Signups",
                source: "first-party",
                sql: "SELECT COUNT(*) AS signups FROM analytics_events",
              },
            ],
          },
          certification,
          updatedAt: "v1",
          favorite: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("ranks exact runnable panels ahead of partial certified panels", () => {
    const certification = {
      status: "certified" as const,
      certifiedAt: "2026-08-28T00:00:00.000Z",
      certifiedBy: "admin@example.com",
      certifiedForUpdatedAt: "v1",
    };
    const results = rankAnalyticsQueryCatalog({
      search: "revenue growth",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "certified-revenue",
          title: "Revenue",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "revenue",
                title: "Revenue",
                source: "first-party",
                sql: "SELECT revenue FROM revenue_events",
              },
            ],
          },
          certification,
          updatedAt: "v1",
        },
        {
          id: "ordinary-revenue-growth",
          title: "Revenue Growth",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "revenue-growth",
                title: "Revenue Growth",
                source: "first-party",
                sql: "SELECT revenue, growth FROM revenue_events",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      dashboardId: "ordinary-revenue-growth",
      dashboardCertified: false,
    });
    expect(results[1]).toMatchObject({
      dashboardId: "certified-revenue",
      dashboardCertified: true,
    });
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

  it("lets an exact runnable panel outrank a generic single-token dictionary match", () => {
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

  it("does not let a partial approved definition outrank an exact runnable panel", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly active users by region",
      limit: 6,
      dashboards: [
        {
          id: "d1",
          title: "Product Usage",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "mau-by-region",
                title: "Monthly Active Users by Region",
                source: "bigquery",
                sql: "SELECT month, region, COUNT(DISTINCT user_id) FROM product_usage GROUP BY 1, 2",
              },
            ],
          },
        },
      ],
      dictionaryEntries: [
        {
          id: "monthly-active-users",
          metric: "Monthly Active Users",
          definition: "Distinct users active in a month",
          approved: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "dashboard-panel",
      panelId: "mau-by-region",
    });
  });

  it("keeps partial approved definitions ahead of partial certified panels", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly active users by region",
      limit: 6,
      dashboards: [
        {
          id: "certified-usage",
          title: "Product Usage",
          origin: "saved-dashboard",
          certification: {
            status: "certified",
            certifiedAt: "2026-10-01T00:00:00.000Z",
            certifiedBy: "reviewer@example.com",
            certifiedForUpdatedAt: "v1",
          },
          updatedAt: "v1",
          config: {
            panels: [
              {
                id: "active-users-by-region",
                title: "Active Users by Region",
                source: "bigquery",
                sql: "SELECT region, COUNT(DISTINCT user_id) FROM usage GROUP BY 1",
              },
            ],
          },
        },
      ],
      dictionaryEntries: [
        {
          id: "monthly-active-users",
          metric: "Monthly Active Users",
          definition: "Distinct users active in a month",
          approved: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "monthly-active-users",
      approved: true,
    });
  });

  it("ranks approved definitions ahead of certified panels but generated dbt below", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "revenue",
      limit: 6,
      dashboards: [
        {
          id: "certified-revenue",
          title: "Revenue",
          origin: "saved-dashboard",
          certification: {
            status: "certified",
            certifiedAt: "2026-10-01T00:00:00.000Z",
            certifiedBy: "reviewer@example.com",
            certifiedForUpdatedAt: "v1",
          },
          updatedAt: "v1",
          config: {
            panels: [
              {
                id: "revenue",
                title: "Revenue",
                source: "first-party",
                sql: "SELECT revenue FROM revenue_events",
              },
            ],
          },
        },
      ],
      dictionaryEntries: [
        {
          id: "approved-revenue-definition",
          metric: "Revenue",
          definition: "Revenue recognized from closed-won deals",
          approved: true,
        },
        {
          id: "dbt-revenue-definition",
          metric: "Revenue",
          definition: "Revenue recognized from closed-won deals",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "approved-revenue-definition",
      approved: true,
    });
    expect(results[1]).toMatchObject({
      kind: "dashboard-panel",
      panelId: "revenue",
      dashboardCertified: true,
    });
    expect(results[2]).toMatchObject({
      kind: "data-dictionary",
      id: "dbt-revenue-definition",
      origin: "source-index",
      sourceKind: "dbt",
      approved: false,
      aiGenerated: true,
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

  it('drops stop words before stemming so "this" is not a term', () => {
    expect(searchTerms("what is this app")).toEqual(["app"]);
    expect(searchTerms("translate this to Spanish")).toEqual([
      "translate",
      "spanish",
    ]);
  });

  it("keeps only terms specific enough to make a reference relevant", () => {
    expect(relevanceTerms("what's our NRR")).toEqual(["nrr"]);
    expect(relevanceTerms("Q3 bookings")).toEqual(["booking"]);
    expect(relevanceTerms("ok do it")).toEqual([]);
    expect(relevanceTerms("how do I share a dashboard")).toEqual(["share"]);
  });

  it("does not count a term found inside a longer word as matched", () => {
    const [match] = rankAnalyticsQueryCatalog({
      search: "ear",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        { id: "early", metric: "Early access signups", approved: true },
      ],
    });

    expect(match).toMatchObject({ id: "early", matchedTerms: [] });
  });
});
