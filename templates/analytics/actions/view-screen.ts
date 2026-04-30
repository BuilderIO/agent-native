import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { readAppState } from "@agent-native/core/application-state";
import { getDashboard } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, dashboard config (if on a dashboard), and any active URL filter params. Always call this first before taking any action.",
  parameters: {},
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");
    const url = (await readAppState("__url__")) as {
      pathname?: string;
      search?: string;
      searchParams?: Record<string, string>;
    } | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (url?.pathname) screen.pathname = url.pathname;

    // Surface the active URL filter params (f_*) so the agent doesn't have
    // to reason about the URL string or go hunting in settings for them.
    // To change a filter, use the `set-search-params` tool with these keys.
    if (url?.searchParams) {
      const activeFilters: Record<string, string> = {};
      for (const [k, v] of Object.entries(url.searchParams)) {
        if (k.startsWith("f_") && v) activeFilters[k] = v;
      }
      if (Object.keys(activeFilters).length > 0) {
        screen.activeFilters = activeFilters;
      }
    }

    const nav = navigation as any;

    if (nav?.view === "adhoc" && nav?.dashboardId) {
      try {
        const orgId = getRequestOrgId() || null;
        const email = getRequestUserEmail();
        if (email) {
          const dashboard = await getDashboard(nav.dashboardId, {
            email,
            orgId,
          });
          if (dashboard) screen.dashboard = dashboard.config;
        }
      } catch {
        // Dashboard config not found
      }
    } else if (nav?.view === "analyses") {
      screen.page = "analyses";
      if (nav?.analysisId) {
        screen.analysisId = nav.analysisId;
      }
    } else if (nav?.view === "overview" || nav?.view === "home" || !nav?.view) {
      screen.page = "overview";
    } else if (nav?.view === "query") {
      screen.page = "query";
    } else if (nav?.view === "data-sources") {
      screen.page = "data-sources";
    } else if (nav?.view === "settings") {
      screen.page = "settings";
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
