/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches matching dashboard config if applicable.
 *
 * Usage:
 *   pnpm script view-screen
 */

import { parseArgs, output } from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import { readSetting } from "@agent-native/core/settings";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view and dashboard config if on a dashboard. Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = navigation as any;

  if (nav?.view === "adhoc" && nav?.dashboardId) {
    // On a specific dashboard — read its config
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
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  const result = await run(args);

  try {
    const parsed = JSON.parse(result);
    const nav = parsed.navigation;

    console.error(
      `Current view: ${nav?.view ?? "overview"}` +
        (nav?.dashboardId ? ` (dashboard: ${nav.dashboardId})` : ""),
    );
    output(parsed);
  } catch {
    console.log(result);
  }
}
