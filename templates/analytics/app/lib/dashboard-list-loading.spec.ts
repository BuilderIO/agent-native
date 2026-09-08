import { describe, expect, it } from "vitest";

import { shouldRenderDashboardList } from "./dashboard-list-loading";

const ready = {
  sqlDashboardsLoading: false,
  sqlDashboardsPlaceholder: false,
  isInitialLoad: true,
  favoritesLoading: false,
  popularityReady: true,
  sortMode: "most-used" as const,
};

describe("shouldRenderDashboardList", () => {
  it.each([
    ["SQL is loading", { sqlDashboardsLoading: true }],
    ["SQL dashboards are placeholders", { sqlDashboardsPlaceholder: true }],
    ["favorites are loading", { favoritesLoading: true }],
    ["popularity is not ready", { popularityReady: false }],
  ])("returns false while %s for most-used sorting", (_reason, overrides) => {
    expect(shouldRenderDashboardList({ ...ready, ...overrides })).toBe(false);
  });

  it("keeps the last list visible during a settled refresh", () => {
    expect(
      shouldRenderDashboardList({
        ...ready,
        sqlDashboardsPlaceholder: true,
        isInitialLoad: false,
      }),
    ).toBe(true);
  });

  it.each(["alphabetical", "manual"] as const)(
    "only requires SQL to be settled for %s sorting",
    (sortMode) => {
      expect(
        shouldRenderDashboardList({
          ...ready,
          favoritesLoading: true,
          popularityReady: false,
          sortMode,
        }),
      ).toBe(true);
    },
  );

  it("returns true when most-used sorting inputs are ready", () => {
    expect(shouldRenderDashboardList(ready)).toBe(true);
  });
});
