import { describe, expect, it } from "vitest";

import { resolveDashboardFilterRestore } from "./dashboard-filter-restore";

describe("resolveDashboardFilterRestore", () => {
  it("preserves explicit URL filters and views", () => {
    const defaultView = { id: "90-days", filters: { f_timeRange: "90d" } };

    expect(
      resolveDashboardFilterRestore(
        new URLSearchParams("f_timeRange=30d"),
        defaultView,
        { f_timeRange: "7d" },
      ),
    ).toBeNull();
    expect(
      resolveDashboardFilterRestore(
        new URLSearchParams("view=custom-view"),
        defaultView,
        { f_timeRange: "7d" },
      ),
    ).toBeNull();
  });

  it("applies the dashboard default before the user's last filters", () => {
    expect(
      resolveDashboardFilterRestore(
        new URLSearchParams(),
        { id: "90-days", filters: { f_timeRange: "90d" } },
        { f_timeRange: "7d" },
      ),
    ).toEqual({
      filters: { f_timeRange: "90d" },
      viewId: "90-days",
    });
  });

  it("falls back to the user's last filters when no dashboard default exists", () => {
    expect(
      resolveDashboardFilterRestore(new URLSearchParams(), undefined, {
        f_timeRange: "7d",
      }),
    ).toEqual({ filters: { f_timeRange: "7d" } });
  });
});
