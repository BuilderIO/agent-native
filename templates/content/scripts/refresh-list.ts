/**
 * Refresh the document list in the UI.
 *
 * Triggers the UI to refetch documents by writing a signal to application state.
 *
 * Usage:
 *   pnpm script refresh-list
 */

import { parseArgs } from "./_utils.js";
import { writeAppState } from "@agent-native/core/application-state";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log("Usage: pnpm script refresh-list");
    console.log("Triggers the UI to refetch the document list.");
    return;
  }

  await writeAppState("refresh-signal", { ts: Date.now() });
  console.log("Triggered UI refresh");
}
