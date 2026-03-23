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

import { parseArgs, output } from "./helpers.js";
import {
  readAppState,
  listAppState,
} from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

/** Reject IDs that could escape via path traversal. */
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
    const draft = await readAppState(`compose-${safeId}`);
    if (!draft) return `No draft found with id "${safeId}"`;
    return JSON.stringify(draft, null, 2);
  }

  const items = await listAppState("compose-");
  if (items.length === 0) return "No compose drafts are open.";
  const drafts = items.map((item) => item.value);
  return JSON.stringify(drafts, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (args.id) {
    const safeId = sanitizeDraftId(args.id);
    if (!safeId) {
      console.error(`Invalid draft ID "${args.id}"`);
      return;
    }
    const draft = await readAppState(`compose-${safeId}`);
    if (!draft) {
      console.error(`No draft found with id "${safeId}"`);
      return;
    }
    output(draft);
    return;
  }

  const items = await listAppState("compose-");
  const drafts = items.map((item) => item.value);

  if (drafts.length === 0) {
    console.error("No compose drafts are open.");
    output([]);
    return;
  }

  console.error(`${drafts.length} draft(s) open`);
  output(drafts);
}
