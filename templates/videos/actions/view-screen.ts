/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state. If viewing a composition, returns its metadata.
 * If on studio home, returns the list of compositions.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view and composition details. Always call this first before taking any action.",
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;

    if (nav?.compositionId) {
      screen.context = {
        view: "composition",
        compositionId: nav.compositionId,
        hint: "User is editing a composition. Use the registry in app/remotion/registry.ts for composition details.",
      };
    } else {
      screen.context = {
        view: "studio-home",
        hint: "User is on the studio home page. Compositions are registered in app/remotion/registry.ts.",
      };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
