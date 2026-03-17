/**
 * See all open compose drafts.
 *
 * Usage:
 *   pnpm script view-composer
 *   pnpm script view-composer --id=draft-123   (show a specific draft)
 *
 * Options:
 *   --id    Specific draft ID to view (optional)
 */

import fs from "fs";
import path from "path";
import { parseArgs, output } from "./helpers.js";

const STATE_DIR = path.join(process.cwd(), "application-state");

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (args.id) {
    // Show specific draft
    const filePath = path.join(STATE_DIR, `compose-${args.id}.json`);
    try {
      const draft = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      output(draft);
    } catch {
      console.error(`No draft found with id "${args.id}"`);
    }
    return;
  }

  // List all open drafts
  const files = fs
    .readdirSync(STATE_DIR)
    .filter((f) => f.startsWith("compose-") && f.endsWith(".json"));

  if (files.length === 0) {
    console.error("No compose drafts are open.");
    output([]);
    return;
  }

  const drafts = files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  console.error(`${drafts.length} draft(s) open`);
  output(drafts);
}
