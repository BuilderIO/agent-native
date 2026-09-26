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

  it("keeps sidebar navigation compact and footer gutters aligned", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-hidden py-2"',
    );
    expect(source).toContain(
      'className="min-h-0 min-w-0 flex flex-1 flex-col space-y-0.5 overflow-x-hidden overflow-y-auto px-2 py-3"',
    );
    expect(source).toContain(
      'className="mt-3 shrink-0 min-w-0 space-y-1 border-t border-border/70 pt-3"',
    );
    expect(source).not.toContain("bottomItems");
    expect(source).not.toContain('href: "/settings"');
    expect(source).toContain('className="space-y-1 px-2"');
    expect(source).toContain(
      'className="min-w-0 flex-1 !px-2 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"',
    );
    expect(source).toContain("<AppSidebarHeader");
    expect(source).toContain("<AppSidebarFooter");
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
    expect(source).toContain("open={askOpen}");
    expect(source).not.toContain("open={askOpen && isAskRoute}");
  });

  it("keeps Ask filtering compact and visibility-only", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const [askFilter, setAskFilter]");
    expect(source).toContain('label={t("navigation.ask")}');
    expect(source).toContain("visibilityFilter={askFilter}");
    expect(source).toContain("onVisibilityFilterChange={setAskFilter}");
    expect(source).toContain(
      "threadMatchesVisibilityFilter(thread, visibilityFilter)",
    );
  });

  it("renews an active Ask handoff on route entry before the heartbeat interval", () => {
    const source = readFileSync(
      new URL("./Layout.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("if (!isAskRoute) return;");
    const end = source.indexOf(
      "return () => window.clearInterval(interval);",
      start,
    );
    const effectSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(effectSource).toContain("const refreshHandoff = () =>");
    expect(effectSource.indexOf("refreshHandoff();")).toBeLessThan(
      effectSource.indexOf("window.setInterval("),
    );
  });

  it("keeps both collapsed and expanded sidebar spacing compact", () => {
    const source = readFileSync(
      new URL("./Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-3"',
    );
    expect(source).toContain(
      'className="min-h-0 min-w-0 flex flex-1 flex-col space-y-0.5 overflow-x-hidden overflow-y-auto px-2 py-3"',
    );
  });
});
