/**
 * Navigate the UI to a view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=home
 *   pnpm action navigate --path=/some/route
 *
 * Options:
 *   --view   View name to navigate to
 *   --path   URL path to navigate to
 */

import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Navigate the UI to a specific view or path. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    type: "object",
    properties: {
      view: { type: "string", description: "View name to navigate to" },
      path: { type: "string", description: "URL path to navigate to" },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.path) {
    return "Error: At least --view or --path is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.path) nav.path = args.path;
  await writeAppState("navigate", nav);
  return `Navigating to ${args.view || args.path}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  if (!args.view && !args.path) {
    console.error(
      "Error: At least --view or --path is required. Usage: pnpm action navigate --view=home",
    );
    process.exit(1);
  }
  const result = await run(args);
  console.error(result);
  console.log(JSON.stringify({ result }));
}
