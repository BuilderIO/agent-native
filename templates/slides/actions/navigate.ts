/**
 * Navigate the UI to a deck or slide.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=list
 *   pnpm action navigate --deckId=abc123
 *   pnpm action navigate --deckId=abc123 --slideIndex=2
 *
 * Options:
 *   --view        Navigate to a top-level view ("list", "settings")
 *   --deckId      Deck ID to open in the editor
 *   --slideIndex  Slide index to jump to (0-based, used with --deckId)
 */

import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Navigate the UI to a specific deck, slide, or view. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description: "Top-level view to navigate to (list, settings)",
      },
      deckId: {
        type: "string",
        description: "Deck ID to open in the editor",
      },
      slideIndex: {
        type: "string",
        description: "Slide index to jump to (0-based)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.deckId) {
    return "Error: At least --view or --deckId is required.";
  }
  const nav: Record<string, string | number> = {};
  if (args.view) nav.view = args.view;
  if (args.deckId) nav.deckId = args.deckId;
  if (args.slideIndex != null) nav.slideIndex = parseInt(args.slideIndex, 10);
  await writeAppState("navigate", nav);
  return `Navigating to ${args.view || ""}${args.deckId ? ` deck:${args.deckId}` : ""}${args.slideIndex != null ? ` slide:${args.slideIndex}` : ""}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  if (!args.view && !args.deckId) {
    console.error(
      "Error: At least --view or --deckId is required. Usage: pnpm action navigate --deckId=abc123",
    );
    process.exit(1);
  }
  const result = await run(args);
  console.error(result);
  console.log(JSON.stringify({ result }));
}
