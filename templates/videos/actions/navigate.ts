/**
 * Navigate the UI to a composition or the studio home.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=home
 *   pnpm action navigate --compositionId=logo-reveal
 *
 * Options:
 *   --view            Navigate to a top-level view ("home", "components")
 *   --compositionId   Composition ID to open
 */

import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Navigate the UI to a specific composition or view. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description: "Top-level view to navigate to (home, components)",
      },
      compositionId: {
        type: "string",
        description: "Composition ID to open",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.compositionId) {
    return "Error: At least --view or --compositionId is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.compositionId) nav.compositionId = args.compositionId;
  await writeAppState("navigate", nav);
  return `Navigating to ${args.view || ""}${args.compositionId ? ` composition:${args.compositionId}` : ""}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  if (!args.view && !args.compositionId) {
    console.error(
      "Error: At least --view or --compositionId is required. Usage: pnpm action navigate --compositionId=logo-reveal",
    );
    process.exit(1);
  }
  const result = await run(args);
  console.error(result);
  console.log(JSON.stringify({ result }));
}
