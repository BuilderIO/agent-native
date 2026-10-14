import { describe, expect, it } from "vitest";

import {
  candidateQueryPriority,
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
          semanticScope: "product_activity",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
        {
          id: "approved-builder-users",
          metric: "Builder.io user count",
          definition: "Reviewed definition for Builder.io user count",
          table: "product_user_dimension",
          semanticScope: "product_activity",
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

  it("keeps stale source-index grain searchable without trusting it as current", () => {
    const search = "workspace user membership";
    const results = rankAnalyticsQueryCatalog({
      search,
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "stale-workspace-member-role-bridge",
          origin: "source-index",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          sourceIndexStale: true,
          sourceIndexAgeDays: 104,
          sourceIndexStaleAfterDays: 90,
          approved: false,
          aiGenerated: true,
        },
        {
          id: "fresh-workspace-member-role-bridge",
          origin: "source-index",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          sourceIndexStale: false,
          sourceIndexAgeDays: 12,
          sourceIndexStaleAfterDays: 90,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "fresh-workspace-member-role-bridge",
      sourceIndexStale: false,
    });
    const staleCandidate = results.find(
      (candidate) =>
        candidate.kind === "data-dictionary" &&
        candidate.id === "stale-workspace-member-role-bridge",
    );
    const freshCandidate = results.find(
      (candidate) =>
        candidate.kind === "data-dictionary" &&
        candidate.id === "fresh-workspace-member-role-bridge",
    );
    expect(staleCandidate).toMatchObject({
      id: "stale-workspace-member-role-bridge",
      sourceIndexStale: true,
      sourceIndexAgeDays: 104,
    });
    expect(candidateQueryPriority(staleCandidate!, search)).toMatchObject({
      rosterSpecificity: 0,
      membershipRowSpecificity: 0,
      trust: 0,
      scope: 0,
    });
    expect(candidateQueryPriority(freshCandidate!, search)).toMatchObject({
      rosterSpecificity: 0,
      membershipRowSpecificity: 1,
      trust: 3,
      scope: 2,
    });
  });

  it("keeps a stale source-index lead visible despite its outdated conflicting scope", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace member roster",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "stale-workspace-member-roster-lead",
          metric: "Workspace Member Roster",
          definition: "One row per synthetic user-workspace membership record.",
          table: "workspace_member_roster_snapshot",
          columnsUsed: "user_id, workspace_id",
          grain: "One row per user_id per workspace_id",
          semanticScope: "product_activity",
          sourceKind: "dbt",
          sourceIndex: true,
          sourceIndexStale: true,
          sourceIndexAgeDays: 140,
          sourceIndexStaleAfterDays: 90,
          approved: false,
          aiGenerated: true,
          origin: "source-index",
        },
      ],
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "stale-workspace-member-roster-lead",
          sourceIndexStale: true,
        }),
      ]),
    );
  });

  it("keeps an approved stale source-index match below a fresher definition", () => {
    const search = "monthly workspace member count";
    const results = rankAnalyticsQueryCatalog({
      search,
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "stale-approved-monthly-workspace-member-count",
          metric: "Monthly Workspace Member Count",
          definition:
            "Monthly snapshot of synthetic workspace members, retained for discovery.",
          table: "stale_monthly_workspace_member_counts",
          columnsUsed: "month_start, workspace_id, member_count",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          sourceIndexStale: true,
          approved: true,
          aiGenerated: true,
          origin: "source-index",
        },
        {
          id: "current-monthly-workspace-member-total",
          metric: "Monthly Workspace Member Total",
          definition: "Current monthly count of synthetic workspace members.",
          table: "current_monthly_workspace_member_totals",
          columnsUsed: "month_start, workspace_id, member_total",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          sourceIndexStale: false,
          approved: false,
          aiGenerated: true,
          origin: "source-index",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "current-monthly-workspace-member-total",
      sourceIndexStale: false,
    });
    const staleCandidate = results.find(
      (candidate) =>
        candidate.kind === "data-dictionary" &&
        candidate.id === "stale-approved-monthly-workspace-member-count",
    );
    expect(staleCandidate).toMatchObject({
      sourceIndexStale: true,
      approved: true,
    });
    expect(candidateQueryPriority(staleCandidate!, search)).toMatchObject({
      rankingTier: 0,
      trust: 0,
      freshness: 0,
    });
  });

  it("requires row-level role evidence for workspace roster questions", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly User Count",
          definition:
            "Monthly snapshot of user count per organization, captured at month end.",
          table: "dbt_mart.aggregate_monthly_users_per_org",
          columnsUsed: "date_month, org_id, user_count",
          semanticScope: "membership",
          approved: true,
          updateFrequency: "Monthly",
        },
        {
          id: "dbt-workspace-member-role-bridge",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
        {
          id: "dbt-core-users",
          metric: "Workspace user dimension",
          definition: "Core user attributes keyed by user id.",
          table: "dbt_mart.dim_users_core",
          columnsUsed: "user_id, user_email",
          grain: "One row per user",
          primaryEntity: "user",
          semanticScope: "person",
          approved: true,
        },
        {
          id: "dbt-organizations",
          metric: "Workspace organization dimension",
          definition: "Organization attributes keyed by organization id.",
          table: "dbt_mart.dim_organizations",
          columnsUsed: "org_id, organization_name",
          grain: "One row per organization",
          primaryEntity: "organization",
          semanticScope: "organization",
          approved: true,
        },
      ],
    });

    const ids = results.map((candidate) =>
      candidate.kind === "data-dictionary"
        ? candidate.id
        : candidate.dashboardId,
    );
    expect(ids[0]).toBe("dbt-workspace-member-role-bridge");
    expect(ids).toEqual(["dbt-workspace-member-role-bridge"]);
    expect(ids).not.toContain("approved-monthly-workspace-user-count");
  });

  it("searches SQL-projected columns without treating them as trusted roster keys", () => {
    const dictionaryEntries = [
      {
        id: "projected-membership-model",
        metric: "model:user_organization_projection",
        definition:
          "Generated SQL projection metadata; schema is not verified.",
        table: "user_organization_projection",
        sqlProjectedColumns: "user_id, organization_id",
        sourceKind: "dbt",
        sourceIndex: true,
        approved: false,
        aiGenerated: true,
        origin: "source-index",
      },
    ];

    const projectionSearch = rankAnalyticsQueryCatalog({
      search: "organization_id",
      limit: 6,
      dashboards: [],
      dictionaryEntries,
    });
    expect(projectionSearch[0]).toMatchObject({
      id: "projected-membership-model",
      sqlProjectedColumns: "user_id, organization_id",
    });

    const rosterSearch = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries,
    });
    expect(rosterSearch).toEqual([]);
  });

  it("uses parser-inferred membership keys when dbt SQL proves the row grain", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-un-nested-membership",
          metric: "model:user_organization_role",
          definition: "Expanded array-backed membership rows.",
          table: "user_organization_role",
          grain:
            "Expanded grain: one row per user-organization array entry from UNNEST(organizations)",
          sqlProjectedColumns: "user_id, organization_id",
          inferredMembershipKeys: ["user_id", "organization_id"],
          inferredMembershipKeyRoles: {
            user: "user_id",
            organization: "organization_id",
          },
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
          origin: "source-index",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "dbt-un-nested-membership",
      inferredMembershipKeys: ["user_id", "organization_id"],
    });
  });

  it("uses role-mapped aliases and projected role fields for dbt rosters", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-aliased-membership",
          metric: "model:user_organization_aliases",
          definition: "Expanded array-backed membership rows with role detail.",
          table: "user_organization_aliases",
          grain: "One row per member-workspace membership",
          semanticScope: "membership",
          sqlProjectedColumns: "member_key, workspace_key, role_code",
          inferredMembershipKeys: ["member_key", "workspace_key"],
          inferredMembershipKeyRoles: {
            user: "member_key",
            organization: "workspace_key",
          },
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
          origin: "source-index",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "dbt-aliased-membership",
      inferredMembershipKeyRoles: {
        user: "member_key",
        organization: "workspace_key",
      },
    });
  });

  it("ranks direct UNNEST membership rows with aliased identity keys", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-direct-aliased-membership",
          metric: "model:user_organization_aliased_base",
          definition: "Expanded array-backed membership rows with role detail.",
          table: "user_organization_aliased_base",
          grain:
            "Expanded grain: one row per user-organization array entry from UNNEST(organizations)",
          semanticScope: "membership",
          sqlProjectedColumns: "member_key, role_codes, workspace_key",
          inferredMembershipKeys: ["member_key", "workspace_key"],
          inferredMembershipKeyRoles: {
            user: "member_key",
            organization: "workspace_key",
          },
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
          origin: "source-index",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "dbt-direct-aliased-membership",
      inferredMembershipKeys: ["member_key", "workspace_key"],
      inferredMembershipKeyRoles: {
        user: "member_key",
        organization: "workspace_key",
      },
    });
  });

  it("does not infer membership roles from aliases without source role metadata", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-unverified-aliases",
          metric: "model:unverified_aliases",
          definition: "An imported model with ambiguous output keys.",
          table: "unverified_aliases",
          grain: "One row per member-workspace pair.",
          sqlProjectedColumns: "member_key, workspace_key",
          inferredMembershipKeys: ["member_key", "workspace_key"],
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
          origin: "source-index",
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("accepts member identity keys for workspace roster questions", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace member roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-workspace-member-role-bridge",
          metric: "Workspace member roles",
          definition:
            "One row per member-workspace relationship with the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "member_id, workspace_id, role",
          grain: "One row per member-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "dbt-workspace-member-role-bridge",
      sourceKind: "dbt",
    });
  });

  it("rejects active-only sources and historical snapshots for an unfiltered current roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "list full workspace member roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "active-users-by-workspace",
          metric: "Active users by workspace",
          definition:
            "Current active users associated with each workspace, with their role and membership grain.",
          table: "active_users_by_org",
          columnsUsed: "user_id, org_id, role",
          grain: "One row per user-organization membership",
          semanticScope: "membership",
        },
        {
          id: "active-members-only-by-workspace",
          metric: "Workspace member role details",
          definition:
            "Only members who are active in the workspace are included with assigned role details.",
          table: "active_workspace_member_roles",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-organization membership",
          semanticScope: "membership",
        },
        {
          id: "historical-workspace-roles",
          metric: "Historical workspace user roles",
          definition:
            "Historical snapshots of workspace memberships and assigned roles as of each month end.",
          table: "workspace_member_role_history",
          columnsUsed: "user_id, workspace_id, role, snapshot_month",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          updateFrequency: "Daily",
        },
        {
          id: "daily-refreshed-current-workspace-roles",
          metric: "Current workspace user roles",
          definition:
            "Current snapshot of latest workspace memberships and assigned roles; refreshes daily.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          updateFrequency: "Daily",
        },
      ],
    });

    expect(
      results.map((candidate) =>
        candidate.kind === "data-dictionary"
          ? candidate.id
          : candidate.dashboardId,
      ),
    ).toEqual(["daily-refreshed-current-workspace-roles"]);
  });

  it("does not treat non-active members as a request for active-only membership rows", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "workspace members with no counts for non-active members",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "active-members-only",
          metric: "Active workspace members",
          definition: "Only active workspace members and their roles.",
          table: "active_workspace_member_roles",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
        },
        {
          id: "all-workspace-members",
          metric: "Workspace member roles",
          definition: "Current roles for all workspace memberships.",
          table: "workspace_member_roles",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "all-workspace-members",
    });
  });

  it("does not return membership sources for product-activity searches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "active users",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "active-workspace-members",
          metric: "Active workspace members",
          definition: "Current active users associated with each workspace.",
          table: "active_users_by_workspace",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it.each([
    "list active workspace members with roles",
    "list workspace members who are active with roles",
  ])(
    "uses an active-only membership source when the request explicitly asks for active members: %s",
    (search) => {
      const results = rankAnalyticsQueryCatalog({
        search,
        limit: 6,
        dashboards: [],
        dictionaryEntries: [
          {
            id: "active-members-by-workspace",
            metric: "Active members by workspace",
            definition:
              "Current active members associated with each workspace, with their role and membership grain.",
            table: "active_members_by_workspace",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
          },
          {
            id: "all-workspace-members",
            metric: "Workspace member roles",
            definition: "Current roles for all workspace memberships.",
            table: "workspace_member_roles",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
          },
        ],
      });

      expect(results[0]).toMatchObject({
        kind: "data-dictionary",
        id: "active-members-by-workspace",
      });
    },
  );

  it("keeps active-only aggregate metrics eligible for non-roster searches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly member count by organization",
      limit: 5,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "monthly-active-member-count",
          metric: "Monthly Active Member Count by Organization",
          definition: "Monthly count of active organization memberships.",
          table: "monthly_active_members_by_org",
          columnsUsed: "month_start, organization_id, active_member_count",
          grain: "One row per month_start per organization_id",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "monthly-active-member-count",
      }),
    );
  });

  it("keeps monthly workspace user-by-role aggregates out of roster filtering", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly workspace users by role",
      limit: 5,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "monthly-workspace-users-by-role",
          metric: "Monthly Workspace Users by Role",
          definition: "Monthly count of workspace users grouped by role.",
          table: "monthly_workspace_users_by_role",
          columnsUsed: "month_start, workspace_id, role, user_count",
          grain: "One row per month_start, workspace_id, and role",
          semanticScope: "membership",
          approved: true,
          sourceKind: "dbt",
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "monthly-workspace-users-by-role",
      }),
    );
  });

  it("does not let an inactive-user exclusion negate a later positive active-member request", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "exclude inactive users and show active members",
      limit: 5,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "active-members-by-workspace",
          metric: "Active workspace members",
          definition: "Current active workspace members and their roles.",
          table: "active_members_by_workspace",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
        },
        {
          id: "all-workspace-members",
          metric: "Workspace member roles",
          definition: "Current roles for all workspace memberships.",
          table: "workspace_member_roles",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "active-members-by-workspace",
    });
  });

  it.each([
    "do not exclude active members",
    "do not exclude inactive internal trial accounts and active members",
    "not to exclude active members",
    "without excluding active members",
    "do not skip active members",
    "not excluding active members",
    "exclude everyone but active members",
    "remove everyone except active members",
  ])(
    "keeps active-only membership sources when explicitly retained: %s",
    (search) => {
      const results = rankAnalyticsQueryCatalog({
        search,
        limit: 6,
        dashboards: [],
        dictionaryEntries: [
          {
            id: "active-members-by-workspace",
            metric: "Active workspace members",
            definition: "A filtered list of active workspace memberships.",
            table: "active_members_by_workspace",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
          },
          {
            id: "all-workspace-members",
            metric: "Workspace member roles",
            definition: "Current roles for all workspace memberships.",
            table: "workspace_member_roles",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
          },
        ],
      });

      expect(results[0]).toMatchObject({
        kind: "data-dictionary",
        id: "active-members-by-workspace",
      });
    },
  );

  it.each([
    "not active workspace members",
    "exclude active workspace members",
    "not including active members",
    "exclude all members including active members",
    "show all workspace members except active workspace members",
    "workspace users with no counts by role and region and product area and subscription plan and final request category and exclude internal test trial accounts and active members",
    "do not exclude internal test trial accounts and exclude active members",
    "do not exclude inactive internal trial accounts and no active members",
    "do not exclude internal test trial accounts, but exclude active members",
    "do not exclude internal accounts; active members are excluded",
    "show all members; do not include active workspace users in a separate subset",
    "all workspace members; active members are excluded",
  ])(
    "does not select active-only sources for a negated active-member request: %s",
    (search) => {
      const results = rankAnalyticsQueryCatalog({
        search,
        limit: 6,
        dashboards: [],
        dictionaryEntries: [
          {
            id: "active-members-by-workspace",
            metric: "Active workspace members",
            definition: "A filtered list of active workspace memberships.",
            table: "active_members_by_workspace",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
          },
          {
            id: "all-workspace-members",
            metric: "Workspace member roles",
            definition: "Current roles for all workspace memberships.",
            table: "workspace_member_roles",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
          },
        ],
      });

      const ids = results.map((candidate) =>
        candidate.kind === "data-dictionary"
          ? candidate.id
          : candidate.dashboardId,
      );
      expect(ids).not.toContain("active-members-by-workspace");
      expect(ids).toContain("all-workspace-members");
    },
  );

  it("respects explicit membership scope for active-only metadata without role fields", () => {
    const dictionaryEntries = [
      {
        id: "active-members-no-role",
        metric: "Active workspace members",
        definition: "Current active workspace members.",
        table: "active_workspace_members",
        columnsUsed: "user_id, workspace_id",
        grain: "One row per user-workspace membership",
        semanticScope: "membership",
      },
      {
        id: "event-members-no-role",
        metric: "Active workspace members from events",
        definition: "Workspace members who triggered an event.",
        table: "event_members_by_workspace",
        columnsUsed: "user_id, workspace_id",
        grain: "One row per user-workspace membership",
        semanticScope: "membership",
      },
    ];
    const activeResults = rankAnalyticsQueryCatalog({
      search: "list active workspace members",
      limit: 6,
      dashboards: [],
      dictionaryEntries,
    });
    const unfilteredResults = rankAnalyticsQueryCatalog({
      search: "list workspace members",
      limit: 6,
      dashboards: [],
      dictionaryEntries,
    });

    const ids = (results: typeof activeResults) =>
      results.map((candidate) =>
        candidate.kind === "data-dictionary"
          ? candidate.id
          : candidate.dashboardId,
      );
    expect(ids(activeResults)).toContain("active-members-no-role");
    expect(ids(activeResults)).not.toContain("event-members-no-role");
    expect(ids(unfilteredResults)).not.toContain("active-members-no-role");
  });

  it("keeps an approved roster definition ahead of an unapproved active-only source", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "list active workspace members with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "active-members-by-workspace",
          metric: "Active members by workspace",
          definition:
            "Current active members associated with each workspace, with their role and membership grain.",
          table: "active_members_by_workspace",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceIndex: true,
          aiGenerated: true,
          approved: false,
        },
        {
          id: "approved-workspace-member-roles",
          metric: "Workspace member roles",
          definition: "Current roles for all workspace memberships.",
          table: "workspace_member_roles",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "data-dictionary",
      id: "approved-workspace-member-roles",
    });
  });

  it("keeps a row-level membership bridge ahead of an approved monthly aggregate for plain membership searches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "workspace membership",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly workspace user count",
          definition: "Month-end count of users by workspace.",
          table: "workspace_user_monthly_rollup",
          columnsUsed: "workspace_id, month, user_count",
          grain: "One row per workspace per month",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "workspace-membership-bridge",
          metric: "Workspace membership bridge",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(
      results.map((candidate) =>
        candidate.kind === "data-dictionary"
          ? candidate.id
          : candidate.dashboardId,
      ),
    ).toEqual([
      "workspace-membership-bridge",
      "approved-monthly-workspace-user-count",
    ]);
  });

  it("ignores a negated live-count instruction when ranking workspace members", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "workspace users; do not report live counts",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly workspace user count",
          definition: "Month-end count of users by workspace.",
          table: "workspace_user_monthly_rollup",
          columnsUsed: "workspace_id, month, user_count",
          grain: "One row per workspace per month",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "workspace-membership-bridge",
          metric: "Workspace membership bridge",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "workspace-membership-bridge",
      grain: "One row per user-workspace membership",
    });
  });

  it("ignores a comma-prefixed negated live-count instruction when ranking workspace members", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "workspace users, but don't report live counts",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly workspace user count",
          definition: "Month-end count of users by workspace.",
          table: "workspace_user_monthly_rollup",
          columnsUsed: "workspace_id, month, user_count",
          grain: "One row per workspace per month",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "workspace-membership-bridge",
          metric: "Workspace membership bridge",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "workspace-membership-bridge",
      grain: "One row per user-workspace membership",
    });
  });

  it.each([
    "workspace users, no live counts",
    "workspace users without a count",
    "workspace users, do not report live counts by role",
    "workspace users. Metadata only; do not report live counts or values.",
    "Find the catalog reference for workspace users, no live counts. Metadata only; do not report live counts or values.",
  ])(
    "ignores non-positive count wording (%s) when ranking workspace members",
    (search) => {
      const results = rankAnalyticsQueryCatalog({
        search,
        limit: 6,
        dashboards: [],
        dictionaryEntries: [
          {
            id: "approved-monthly-workspace-user-count",
            metric: "Monthly workspace user count",
            definition: "Month-end count of users by workspace.",
            table: "workspace_user_monthly_rollup",
            columnsUsed: "workspace_id, month, user_count",
            grain: "One row per workspace per month",
            semanticScope: "membership",
            approved: true,
          },
          {
            id: "workspace-membership-bridge",
            metric: "Workspace membership bridge",
            definition:
              "One row per user-workspace membership, including the assigned role.",
            table: "workspace_member_role_bridge",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
            sourceKind: "dbt",
            sourceIndex: true,
            approved: false,
            aiGenerated: true,
          },
          {
            id: "active-workspace-membership-bridge",
            metric: "Active workspace membership bridge",
            definition:
              "Current active workspace members with one row per user-workspace membership.",
            table: "active_workspace_member_roles",
            columnsUsed: "user_id, workspace_id, role",
            grain: "One row per user-workspace membership",
            semanticScope: "membership",
            sourceKind: "dbt",
            sourceIndex: true,
            approved: false,
            aiGenerated: true,
          },
        ],
      });

      expect(results[0]).toMatchObject({
        id: "workspace-membership-bridge",
        grain: "One row per user-workspace membership",
      });
    },
  );

  it("keeps approved monthly metrics for explicit month-count questions", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly workspace user count",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly workspace user count",
          definition: "Month-end count of users by workspace.",
          table: "workspace_user_monthly_rollup",
          columnsUsed: "workspace_id, month, user_count",
          grain: "One row per workspace per month",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "dbt-workspace-member-role-bridge",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "approved-monthly-workspace-user-count",
      approved: true,
    });
  });

  it("keeps active membership aggregates eligible for unqualified aggregate searches", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly member count by org",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-active-member-count",
          metric: "Monthly Active Member Count",
          definition:
            "Monthly aggregate of active memberships by organization.",
          table: "monthly_active_member_count",
          columnsUsed: "month, organization_id, active_member_count",
          grain: "One row per organization per month",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "approved-monthly-active-member-count",
      table: "monthly_active_member_count",
    });
  });

  it("keeps an approved monthly count for a ranked aggregate question", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "which organization had the highest monthly user count",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly User Count",
          definition: "Monthly snapshot of user count per organization.",
          table: "dbt_mart.aggregate_monthly_users_per_org",
          columnsUsed: "date_month, org_id, user_count",
          semanticScope: "membership",
          approved: true,
          updateFrequency: "Monthly",
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "approved-monthly-workspace-user-count",
      approved: true,
    });
  });

  it("keeps aggregates for access-count questions without a role dimension", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "how many members have access per workspace",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-workspace-member-count",
          metric: "Workspace Member Count",
          definition: "A count of members per workspace and month.",
          table: "workspace_member_monthly_counts",
          columnsUsed: "workspace_id, month, member_count",
          grain: "One row per workspace and month",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "approved-workspace-member-count",
      approved: true,
    });
  });

  it("keeps the role source for a role breakdown when the approved aggregate lacks role", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "count of workspace users by role",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly workspace user count",
          definition: "Month-end count of users by workspace.",
          table: "workspace_user_monthly_rollup",
          columnsUsed: "workspace_id, month, user_count",
          grain: "One row per workspace per month",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "dbt-workspace-member-role-bridge",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(
      results.map((candidate) =>
        candidate.kind === "data-dictionary"
          ? candidate.id
          : candidate.dashboardId,
      ),
    ).toEqual(["dbt-workspace-member-role-bridge"]);
  });

  it.each([
    "workspace users breakdown by role",
    "workspace users split by role",
  ])("keeps approved role aggregates for breakdown wording: %s", (search) => {
    const results = rankAnalyticsQueryCatalog({
      search,
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-workspace-users-by-role",
          metric: "Monthly workspace user breakdown by role",
          definition: "Month-end breakdown of workspace users by role.",
          table: "workspace_user_role_monthly_rollup",
          columnsUsed: "workspace_id, month, role, user_count",
          grain: "One row per workspace, month, and role",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "approved-workspace-users-by-role",
        approved: true,
      }),
    );
  });

  it("prefers an approved aggregate when it contains the requested role dimension", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly workspace user count by role",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count-by-role",
          metric: "Monthly workspace user count by role",
          definition: "Month-end user counts by workspace and assigned role.",
          table: "workspace_user_role_monthly_rollup",
          columnsUsed: "workspace_id, month, role, user_count",
          grain: "One row per workspace, month, and role",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "dbt-workspace-member-role-bridge",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including the assigned role.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "approved-monthly-workspace-user-count-by-role",
      approved: true,
    });
  });

  it("does not offer an aggregate when no roster metadata is available", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "approved-monthly-workspace-user-count",
          metric: "Monthly workspace user count",
          definition: "Month-end count of users by workspace.",
          table: "workspace_user_monthly_rollup",
          columnsUsed: "workspace_id, month, user_count",
          grain: "One row per workspace per month",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("does not use disconnected user and organization dimensions for a role roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-core-users",
          metric: "Workspace user dimension",
          definition: "Core user attributes keyed by user id.",
          table: "dbt_mart.dim_users_core",
          columnsUsed: "user_id, user_email",
          grain: "One row per user",
          primaryEntity: "user",
          semanticScope: "person",
          approved: true,
        },
        {
          id: "dbt-organizations",
          metric: "Workspace organization dimension",
          definition: "Organization attributes keyed by organization id.",
          table: "dbt_mart.dim_organizations",
          columnsUsed: "org_id, organization_name",
          grain: "One row per organization",
          primaryEntity: "organization",
          semanticScope: "organization",
          approved: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("does not combine one-sided user and organization dimensions into a roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-core-users",
          metric: "Workspace user dimension",
          definition: "Core user attributes keyed by user id.",
          table: "dbt_mart.dim_users_core",
          columnsUsed: "user_id, workspace_id, user_email",
          grain: "One row per user",
          primaryEntity: "user",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "dbt-workspaces",
          metric: "Workspace dimension",
          definition: "Workspace attributes keyed by workspace id.",
          table: "dbt_mart.dim_workspaces",
          columnsUsed: "workspace_id, workspace_name",
          grain: "One row per workspace",
          primaryEntity: "workspace",
          semanticScope: "organization",
          approved: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("does not use product activity rows as a user-organization roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "product-event-actors",
          metric: "Workspace User Event Actors",
          definition: "One row per product event actor and organization.",
          table: "analytics_product_events",
          columnsUsed: "user_id, workspace_id, organization_role, event_name",
          grain: "One row per event",
          semanticScope: "product_activity",
          approved: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("requires membership relation evidence for dashboard roster panels", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current organization user roster with roles",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "product-events",
          title: "Organization user activity",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "event-actors",
                title: "User roles by organization",
                sql: "SELECT user_id, organization_id, organization_role FROM product_events",
              },
            ],
          },
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("recognizes plural membership table names in dashboard roster panels", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current organization user roster with roles",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "organization-memberships",
          title: "Organization member roles",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "member-roles",
                title: "Organization member roles",
                sql: "SELECT user_id, organization_id, role FROM organization_memberships",
              },
            ],
          },
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "dashboard-panel",
        dashboardId: "organization-memberships",
      }),
    );
  });

  it("does not treat monthly membership snapshots as a current roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "monthly-user-workspace-role-snapshot",
          metric: "Workspace user roles",
          definition:
            "Month-end snapshot of user-workspace memberships and assigned roles.",
          table: "workspace_user_roles_history",
          columnsUsed: "user_id, workspace_id, role, snapshot_month",
          grain: "One row per user-workspace membership per month",
          semanticScope: "membership",
          approved: true,
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("lets explicit membership grain override an incidental member count column", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "dbt-workspace-member-role-bridge-with-count",
          metric: "Workspace user roles",
          definition:
            "One row per user-workspace membership, including assigned role and a member count attribute.",
          table: "workspace_member_role_bridge",
          columnsUsed: "user_id, workspace_id, role, member_count",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
          sourceKind: "dbt",
          sourceIndex: true,
          approved: false,
          aiGenerated: true,
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "dbt-workspace-member-role-bridge-with-count",
      sourceKind: "dbt",
    });
  });

  it("does not mistake a last-access timestamp for a role field", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "workspace-member-access-events",
          metric: "Workspace member access events",
          definition: "A row records when a user last accessed a workspace.",
          table: "workspace_member_access_events",
          columnsUsed: "user_id, workspace_id, last_access_at",
          grain: "One row per user-workspace membership",
          semanticScope: "membership",
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("does not use an aggregated dashboard as a user-role roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "workspace-role-summary",
          title: "Workspace User Roles",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "role-counts",
                title: "Users by role",
                sql: "SELECT workspace_id, user_id, role, COUNT(*) AS member_count FROM memberships GROUP BY workspace_id, user_id, role",
              },
            ],
          },
        },
      ],
    });

    expect(results).toEqual([]);
  });

  it("uses a dashboard panel with normalized membership keys as a role roster", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "current workspace user roster with roles",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "workspace-membership-dashboard",
          title: "Workspace Membership",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "membership-roster",
                title: "Workspace User Roles",
                sql: "SELECT user_id, workspace_id, role FROM workspace_membership",
              },
            ],
          },
        },
      ],
    });

    expect(results[0]).toMatchObject({
      kind: "dashboard-panel",
      dashboardId: "workspace-membership-dashboard",
      panelId: "membership-roster",
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

  it("prefers an exact activity scope over approved membership fallback data", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "which users in organizations triggered events",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "organization-user-membership",
          metric: "Organization User Role Membership",
          definition: "One row per user-organization membership with a role.",
          table: "synthetic_user_organization_role",
          columnsUsed: "user_id, organization_id, organization_role",
          grain: "One row per user-organization membership",
          semanticScope: "membership",
          approved: true,
        },
        {
          id: "organization-user-events",
          metric: "Organization User Product Activity Events",
          definition: "User events triggered inside organizations.",
          table: "synthetic_organization_user_events",
          semanticScope: "product_activity",
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
    ).toEqual(["organization-user-events"]);
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

  it("preserves an exact single-term metric match despite unrelated name terms", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "show churn",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "customer-churn-segment",
          metric: "Customer Retention Churn Region Segment",
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "customer-churn-segment",
        matchedTerms: ["churn"],
        exactMatchedTerms: ["churn"],
      }),
    );
  });

  it("keeps a positive partial dictionary match visible after a large name penalty", () => {
    const results = rankAnalyticsQueryCatalog({
      search: "monthly churn",
      limit: 6,
      dashboards: [],
      dictionaryEntries: [
        {
          id: "customer-retention-churn",
          metric: "Customer Retention Churn Region Segment",
          definition: "Monthly subscription churn by customer segment.",
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "data-dictionary",
        id: "customer-retention-churn",
      }),
    );
    expect(results[0]?.score).toBeGreaterThan(0);
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

  it("keeps a partially relevant panel when title penalties exceed its raw match", () => {
    const results = rankAnalyticsQueryCatalog({
      search:
        "monthly active users signups by plan for quarter enterprise adoption retention",
      limit: 6,
      dictionaryEntries: [],
      dashboards: [
        {
          id: "d1",
          title: "Overview",
          origin: "saved-dashboard",
          config: {
            panels: [
              {
                id: "monthly-churn-by-region",
                title: "Monthly Churn by Region Customer Segment",
                source: "bigquery",
                sql: "SELECT user_id, event_name FROM usage_by_plan",
              },
            ],
          },
        },
      ],
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        kind: "dashboard-panel",
        panelId: "monthly-churn-by-region",
        matchedTerms: expect.arrayContaining(["monthly", "user"]),
      }),
    );
    expect(results[0]?.score).toBeGreaterThan(0);
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
