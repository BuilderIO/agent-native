/**
 * Navigate the UI to a view or dashboard.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=overview
 *   pnpm action navigate --view=adhoc --dashboardId=weekly-metrics
 *   pnpm action navigate --view=query
 *   pnpm action navigate --view=data-sources
 *   pnpm action navigate --view=settings
 *
 * Options:
 *   --view         View to navigate to (overview, adhoc, query, data-sources, settings)
 *   --dashboardId  Dashboard ID to open (used with --view=adhoc)
 */

import { parseArgs, output, fatal } from "./helpers.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Navigate the UI to a specific view or dashboard. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description:
          "View to navigate to (overview, adhoc, query, data-sources, settings)",
      },
      dashboardId: {
        type: "string",
        description: "Dashboard ID to open (used with view=adhoc)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.dashboardId) {
    return "Error: At least --view or --dashboardId is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.dashboardId) {
    nav.dashboardId = args.dashboardId;
    if (!args.view) nav.view = "adhoc";
  }
  await writeAppState("navigate", nav);

  const parts: string[] = [];
  if (nav.view) parts.push(nav.view);
  if (nav.dashboardId) parts.push(`dashboard:${nav.dashboardId}`);
  return `Navigating to ${parts.join(" ")}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.view && !args.dashboardId) {
    fatal(
      "At least --view or --dashboardId is required. Usage: pnpm action navigate --view=overview",
    );
  }
  const result = await run(args);
  console.error(result);
  output({ result });
}
