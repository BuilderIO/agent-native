/**
 * Navigate the UI to a view or thread.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm script navigate --view=inbox
 *   pnpm script navigate --view=starred
 *   pnpm script navigate --threadId=thread-123
 *   pnpm script navigate --view=inbox --threadId=thread-123
 *
 * Options:
 *   --view       View to navigate to (inbox, starred, sent, drafts, archive, trash, or a label ID)
 *   --threadId   Thread to open
 */

import { parseArgs, output, fatal } from "./helpers.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Navigate the UI to a specific view or email thread. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description:
          "View to navigate to (inbox, starred, sent, drafts, archive, trash)",
      },
      threadId: { type: "string", description: "Thread ID to open" },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.threadId) {
    return "Error: At least --view or --threadId is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.threadId) nav.threadId = args.threadId;
  await writeAppState("navigate", nav);
  return `Navigating to ${args.view || ""}${args.threadId ? ` thread:${args.threadId}` : ""}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.view && !args.threadId) {
    fatal(
      "At least --view or --threadId is required. Usage: pnpm script navigate --view=inbox",
    );
  }
  const result = await run(args);
  console.error(result);
  output({ result });
}
