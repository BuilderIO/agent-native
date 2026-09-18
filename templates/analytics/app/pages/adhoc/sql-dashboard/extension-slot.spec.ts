import { describe, expect, it } from "vitest";

import { dashboardExtensionSlotId } from "./extension-slot";

describe("dashboardExtensionSlotId", () => {
  it("keeps each dashboard panel in an independently addressable slot", () => {
    expect(dashboardExtensionSlotId("dashboard-1", "revenue-widget")).toBe(
      "analytics.dashboard.dashboard-1.panel.revenue-widget",
    );
    expect(dashboardExtensionSlotId("dashboard/1", "widget/a")).toBe(
      "analytics.dashboard.dashboard%2F1.panel.widget%2Fa",
    );
  });
});
