import { describe, expect, it } from "vitest";

import {
  buildOpenRouteLink,
  buildOpenRoutePath,
  buildResourceRoute,
  buildSettingsRoute,
  buildStandardAppRoute,
  createStandardOpenPathResolver,
} from "./index.js";

describe("navigation kit helpers", () => {
  it("builds standard app and settings routes", () => {
    expect(buildStandardAppRoute("home")).toBe("/");
    expect(buildStandardAppRoute("settings")).toBe("/settings");
    expect(buildStandardAppRoute("settings", { settingsTab: "secrets" })).toBe(
      "/settings#secrets",
    );
    expect(buildSettingsRoute("what's new")).toBe("/settings#whats-new");
    expect(buildStandardAppRoute("team", { teamInSettings: true })).toBe(
      "/settings#organization",
    );
  });

  it("builds encoded resource routes", () => {
    expect(buildResourceRoute("dashboards", "q3 forecast")).toBe(
      "/dashboards/q3%20forecast",
    );
    expect(
      buildResourceRoute("content/pages", "home", { basePath: "/admin" }),
    ).toBe("/admin/content/pages/home");
  });

  it("builds open-route links with sidebar collapsed", () => {
    expect(
      buildOpenRoutePath({
        app: "analytics",
        view: "dashboard",
        params: { dashboardId: "dash_1", empty: "" },
      }),
    ).toBe(
      "/_agent-native/open?app=analytics&view=dashboard&dashboardId=dash_1&agentSidebar=closed",
    );

    expect(
      buildOpenRouteLink({
        view: "document",
        to: "/documents/doc_1",
        label: "Open document",
      }),
    ).toEqual({
      view: "document",
      to: "/documents/doc_1",
      label: "Open document",
      url: "/_agent-native/open?view=document&to=%2Fdocuments%2Fdoc_1&agentSidebar=closed",
    });
  });

  it("creates standard open-path resolvers", () => {
    const resolveOpenPath = createStandardOpenPathResolver({
      dashboard: (params) => `/dashboards/${params.dashboardId}`,
      settings: "/settings",
    });

    expect(
      resolveOpenPath({
        view: "dashboard",
        params: { dashboardId: "dash_1" },
      }),
    ).toBe("/dashboards/dash_1");
    expect(resolveOpenPath({ view: "settings", params: {} })).toBe("/settings");
    expect(resolveOpenPath({ view: "unknown", params: {} })).toBe("/unknown");
  });
});
