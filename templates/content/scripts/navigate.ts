/**
 * Navigate the UI to a document or view.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm script navigate --path=/
 *   pnpm script navigate --path=/abc123
 *   pnpm script navigate --documentId=abc123
 *
 * Options:
 *   --path        URL path to navigate to (e.g. "/" for list, "/abc123" for a document)
 *   --documentId  Document ID to open (shorthand for --path=/<id>)
 */

import { parseArgs, fail } from "./_utils.js";
import { writeAppState } from "@agent-native/core/application-state";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log("Usage: pnpm script navigate --path=/ | --documentId=abc123");
    console.log("Navigates the UI to a document or view.");
    return;
  }

  let path = opts.path;

  if (!path && opts.documentId) {
    path = `/${opts.documentId}`;
  }

  if (!path) {
    fail("At least --path or --documentId is required");
  }

  await writeAppState("navigate", { path });
  console.log(`Navigating to ${path}`);
}
