import { describe, expect, it } from "vitest";

import {
  isAnalyticsSessionsRoute,
  shouldDefaultOpenAnalyticsSidebar,
} from "./layout-route-policy";

describe("Analytics layout sidebar route policy", () => {
  it("keeps the right agent sidebar closed by default on session routes", () => {
    expect(isAnalyticsSessionsRoute("/sessions")).toBe(true);
    expect(isAnalyticsSessionsRoute("/sessions/sr_123")).toBe(true);
    expect(shouldDefaultOpenAnalyticsSidebar("/sessions")).toBe(false);
    expect(shouldDefaultOpenAnalyticsSidebar("/sessions/sr_123")).toBe(false);
  });

  it("preserves the existing default-open sidebar on non-session routes", () => {
    expect(isAnalyticsSessionsRoute("/ask")).toBe(false);
    expect(isAnalyticsSessionsRoute("/dashboards/revenue")).toBe(false);
    expect(shouldDefaultOpenAnalyticsSidebar("/dashboards/revenue")).toBe(true);
  });
});
