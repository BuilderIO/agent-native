import { describe, expect, it } from "vitest";

import { dashboardCacheScope, sqlDashboardPrefetchKey } from "./prefetch-keys";

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
});
