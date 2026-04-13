/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { listOverview } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description:
    "See what the user is currently looking at in the dispatcher UI, including navigation state and a compact operational summary.",
  http: false,
  run: async () => {
    const [navigation, overview] = await Promise.all([
      readAppState("navigation"),
      listOverview(),
    ]);

    const screen: Record<string, unknown> = {
      counts: overview.counts,
      approvalPolicy: overview.settings,
    };
    if (navigation) screen.navigation = navigation;
    if (navigation?.view === "overview") {
      screen.recentAudit = overview.recentAudit.slice(0, 5);
      screen.recentApprovals = overview.recentApprovals.slice(0, 5);
    }
    if (navigation?.view === "destinations") {
      screen.recentDestinations = overview.recentDestinations;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
