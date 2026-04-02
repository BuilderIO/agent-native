/**
 * Refresh the email list in the UI.
 *
 * Triggers the UI to refetch emails from the API by writing
 * a signal to application state (which fires an SSE event).
 *
 * Run this after making backend changes (archive, trash, mark-read, star, etc.)
 * to ensure the UI reflects the latest state.
 *
 * Usage:
 *   pnpm script refresh-list
 */

import { parseArgs, output } from "./helpers.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Refresh the email list displayed in the UI. Triggers the UI to refetch from Gmail. Call this after any backend change (archive, trash, star, mark-read, send, etc.).",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(_args: Record<string, string>): Promise<string> {
  // Writing to app state triggers an SSE event, which causes the UI
  // to invalidate its email queries and refetch from the API.
  await writeAppState("refresh-signal", { ts: Date.now() });
  return "Triggered UI refresh";
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  const result = await run(args);
  console.error(result);
  output({ refreshed: true });
}
