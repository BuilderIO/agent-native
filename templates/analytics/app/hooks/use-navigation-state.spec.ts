import { describe, expect, it } from "vitest";

import { preserveActiveDashboardTab } from "./use-navigation-state";

describe("preserveActiveDashboardTab", () => {
  it("keeps the active tab when an agent reopens the current dashboard", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/revenue",
        "/dashboards/revenue",
        "?tab=retention&f_date=30d",
      ),
    ).toBe("/dashboards/revenue?tab=retention");
  });

  it("handles the legacy adhoc route for the same dashboard", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/revenue",
        "/adhoc/revenue",
        "?tab=accounts",
      ),
    ).toBe("/dashboards/revenue?tab=accounts");
  });

  it("does not carry a tab to another dashboard", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/acquisition",
        "/dashboards/revenue",
        "?tab=retention",
      ),
    ).toBe("/dashboards/acquisition");
  });

  it("does not overwrite an explicit target query", () => {
    expect(
      preserveActiveDashboardTab(
        "/dashboards/revenue?view=weekly",
        "/dashboards/revenue",
        "?tab=retention",
      ),
    ).toBe("/dashboards/revenue?view=weekly");
  });
});
