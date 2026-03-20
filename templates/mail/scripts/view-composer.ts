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
import type { ScriptTool } from "@agent-native/core";

const STATE_DIR = path.join(process.cwd(), "application-state");

/** Reject IDs that could escape STATE_DIR via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

export const tool: ScriptTool = {
  description: "See all open compose drafts in the compose panel.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Specific draft ID to view (optional)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (args.id) {
    const safeId = sanitizeDraftId(args.id);
    if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
    try {
      const draft = JSON.parse(
        fs.readFileSync(
          path.join(STATE_DIR, `compose-${safeId}.json`),
          "utf-8",
        ),
      );
      return JSON.stringify(draft, null, 2);
    } catch {
      return `No draft found with id "${safeId}"`;
    }
  }

  const files = fs
    .readdirSync(STATE_DIR)
    .filter((f) => f.startsWith("compose-") && f.endsWith(".json"));
  if (files.length === 0) return "No compose drafts are open.";

  const drafts = files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return JSON.stringify(drafts, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (args.id) {
    // Show specific draft
    const safeId = sanitizeDraftId(args.id);
    if (!safeId) {
      console.error(`Invalid draft ID "${args.id}"`);
      return;
    }
    const filePath = path.join(STATE_DIR, `compose-${safeId}.json`);
    try {
      const draft = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      output(draft);
    } catch {
      console.error(`No draft found with id "${safeId}"`);
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
