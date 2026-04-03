/**
 * List all decks from the database.
 *
 * Usage:
 *   pnpm action list-decks
 *   pnpm action list-decks --compact
 *
 * Options:
 *   --compact   Show only id, title, and slide count
 */

import { parseArgs } from "@agent-native/core";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "List all decks from the database with metadata.",
  parameters: {
    type: "object",
    properties: {
      compact: {
        type: "string",
        description: "Set to 'true' for compact output",
        enum: ["true", "false"],
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}/api/decks`);
  if (!res.ok) {
    return `Error: Failed to fetch decks (${res.status})`;
  }
  const decks = await res.json();
  if (!Array.isArray(decks) || decks.length === 0) {
    return JSON.stringify({ count: 0, decks: [] }, null, 2);
  }

  const items = decks.map((d: any) => {
    // The API spreads parsed deck data at the top level, so slides are at d.slides.
    // Fall back to d.data for raw DB rows.
    const slides =
      d.slides ??
      (typeof d.data === "string" ? JSON.parse(d.data) : d.data)?.slides;
    if (args.compact === "true") {
      return {
        id: d.id,
        title: d.title,
        slideCount: slides?.length ?? 0,
      };
    }
    return {
      id: d.id,
      title: d.title,
      slideCount: slides?.length ?? 0,
      createdAt: d.createdAt ?? d.created_at,
      updatedAt: d.updatedAt ?? d.updated_at,
    };
  });

  return JSON.stringify({ count: items.length, decks: items }, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  const result = await run(args);
  try {
    const parsed = JSON.parse(result);
    console.error(`Found ${parsed.count} deck(s)`);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}
