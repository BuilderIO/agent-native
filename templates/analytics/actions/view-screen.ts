import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { readSetting } from "@agent-native/core/settings";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view and dashboard config if on a dashboard. Always call this first before taking any action.",
  parameters: {},
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;

    if (nav?.view === "adhoc" && nav?.dashboardId) {
      try {
        const config = await readSetting(`dashboard-${nav.dashboardId}`);
        if (config) screen.dashboard = config;
      } catch {
        // Dashboard config not found
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
