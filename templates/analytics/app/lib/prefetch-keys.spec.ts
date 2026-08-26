import { describe, expect, it } from "vitest";

import {
  DASHBOARD_SESSION_LOADING_SCOPE,
  dashboardCacheScope,
  preserveScopedDashboardPlaceholder,
  sqlDashboardPrefetchKey,
} from "./prefetch-keys";

describe("dashboard cache scope", () => {
  it("separates principals and active organizations", () => {
    const alice = dashboardCacheScope({
      userId: "alice",
      email: "alice@example.com",
      orgId: "org-1",
    });
    const bob = dashboardCacheScope({
      userId: "bob",
      email: "bob@example.com",
      orgId: "org-1",
    });
    const aliceOtherOrg = dashboardCacheScope({
      userId: "alice",
      email: "alice@example.com",
      orgId: "org-2",
    });

    expect(alice).not.toBe(bob);
    expect(alice).not.toBe(aliceOtherOrg);
    expect(sqlDashboardPrefetchKey("dashboard-1", alice)).not.toEqual(
      sqlDashboardPrefetchKey("dashboard-1", bob),
    );
  });

  it("does not preserve a dashboard list across a scope change", () => {
    const alice = dashboardCacheScope({
      userId: "alice",
      orgId: "org-1",
    });
    const bob = dashboardCacheScope({
      userId: "bob",
      orgId: "org-1",
    });
    const aliceOtherOrg = dashboardCacheScope({
      userId: "alice",
      orgId: "org-2",
    });
    const previous = [{ id: "private-dashboard" }];
    const previousQuery = {
      queryKey: ["sql-dashboards-sidebar", alice, 1],
    };

    expect(
      preserveScopedDashboardPlaceholder(previous, previousQuery, alice),
    ).toBe(previous);
    expect(
      preserveScopedDashboardPlaceholder(previous, previousQuery, bob),
    ).toBeUndefined();
    expect(
      preserveScopedDashboardPlaceholder(
        previous,
        previousQuery,
        aliceOtherOrg,
      ),
    ).toBeUndefined();

    const loadingQuery = {
      queryKey: ["sql-dashboards-sidebar", DASHBOARD_SESSION_LOADING_SCOPE, 1],
    };
    expect(
      preserveScopedDashboardPlaceholder(
        previous,
        loadingQuery,
        dashboardCacheScope(null),
      ),
    ).toBeUndefined();
  });
});
