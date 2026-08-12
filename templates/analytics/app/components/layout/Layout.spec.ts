import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isAnalyticsSessionsRoute,
  resolveAskNavigationAction,
  shouldDefaultOpenAnalyticsSidebar,
} from "./layout-route-policy";

describe("Analytics layout sidebar route policy", () => {
  it("keeps the right agent sidebar closed by default on session routes", () => {
    expect(isAnalyticsSessionsRoute("/sessions")).toBe(true);
    expect(isAnalyticsSessionsRoute("/sessions/sr_123")).toBe(true);
    expect(shouldDefaultOpenAnalyticsSidebar("/sessions")).toBe(false);
    expect(shouldDefaultOpenAnalyticsSidebar("/sessions/sr_123")).toBe(false);
  });

  it("keeps the right agent sidebar closed on dashboard routes", () => {
    expect(isAnalyticsSessionsRoute("/ask")).toBe(false);
    expect(isAnalyticsSessionsRoute("/dashboards/revenue")).toBe(false);
    expect(shouldDefaultOpenAnalyticsSidebar("/dashboards/revenue")).toBe(
      false,
    );
  });

  it("keeps sidebar navigation scrolling separate from its pinned footer", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-hidden py-2"',
    );
    expect(source).toContain(
      'className="min-h-0 flex-1 grid min-w-0 items-start overflow-x-hidden overflow-y-auto px-2 text-sm font-medium lg:px-4 space-y-1"',
    );
    expect(source).toContain(
      'className="shrink-0 min-w-0 px-2 pt-2 text-sm font-medium lg:px-4"',
    );
    expect(source).not.toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-2"',
    );
    expect(source).not.toContain(
      'className="mt-auto min-w-0 px-2 pt-2 text-sm font-medium lg:px-4"',
    );
  });

  it("makes Ask a route-aware toggle while preserving modified-link behavior", () => {
    expect(resolveAskNavigationAction(false, false)).toBe("navigate");
    expect(resolveAskNavigationAction(true, false)).toBe("toggle");
    expect(resolveAskNavigationAction(false, true)).toBe("browser");
    expect(resolveAskNavigationAction(true, true)).toBe("browser");

    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("onClick: handleAskClick");
    expect(source).toContain("onClick={handleAskClick}");
  });

  it("keeps the collapsed rail compact without changing expanded spacing", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1 py-2"',
    );
    expect(source).toContain(
      '"flex h-9 w-9 items-center justify-center rounded-md transition-colors"',
    );
    expect(source).toContain(
      'className="min-h-0 flex-1 grid min-w-0 items-start overflow-x-hidden overflow-y-auto px-2 text-sm font-medium lg:px-4 space-y-1"',
    );
  });
});
