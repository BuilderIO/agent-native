/**
 * Navigate the UI to a view or thread.
 *
 * Writes application-state/navigate.json which the UI reads and auto-deletes.
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

import fs from "fs";
import path from "path";
import { parseArgs, output, fatal } from "./helpers.js";

const STATE_DIR = path.join(process.cwd(), "application-state");

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.view && !args.threadId) {
    fatal(
      "At least --view or --threadId is required. Usage: pnpm script navigate --view=inbox",
    );
  }

  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.threadId) nav.threadId = args.threadId;

  const filePath = path.join(STATE_DIR, "navigate.json");
  fs.writeFileSync(filePath, JSON.stringify(nav, null, 2));

  console.error(
    `Navigating to ${args.view || ""}${args.threadId ? ` thread:${args.threadId}` : ""}`,
  );
  output(nav);
}
