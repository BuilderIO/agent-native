/**
 * Get a specific deck with all slides from the database.
 *
 * Usage:
 *   pnpm action get-deck --id=abc123
 *   pnpm action get-deck --id=abc123 --compact
 *
 * Options:
 *   --id        Deck ID (required)
 *   --compact   Show slide summaries instead of full content
 */

import { parseArgs } from "@agent-native/core";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Get a specific deck with all slides. Returns full deck JSON including slide content.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Deck ID (required)" },
      compact: {
        type: "string",
        description: "Set to 'true' for compact output (slide summaries only)",
        enum: ["true", "false"],
      },
    },
    required: ["id"],
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.id) {
    return "Error: --id is required.";
  }

  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}/api/decks/${args.id}`);
  if (!res.ok) {
    return `Error: Deck not found (${res.status})`;
  }
  const deck = await res.json();
  const data =
    typeof deck.data === "string" ? JSON.parse(deck.data) : deck.data;
  const slides = data?.slides || [];

  if (args.compact === "true") {
    return JSON.stringify(
      {
        id: deck.id,
        title: deck.title || data?.title,
        slideCount: slides.length,
        slides: slides.map((s: any, i: number) => ({
          index: i,
          id: s.id,
          layout: s.layout ?? null,
          textPreview: stripHtml(s.content || "").slice(0, 120),
        })),
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      id: deck.id,
      title: deck.title || data?.title,
      slideCount: slides.length,
      createdAt: deck.createdAt ?? deck.created_at,
      updatedAt: deck.updatedAt ?? deck.updated_at,
      slides: slides.map((s: any, i: number) => ({
        index: i,
        id: s.id,
        layout: s.layout ?? null,
        content: s.content,
      })),
    },
    null,
    2,
  );
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)) as Record<string, string>;
  if (!args.id) {
    console.error(
      "Error: --id is required. Usage: pnpm action get-deck --id=abc123",
    );
    process.exit(1);
  }
  const result = await run(args);
  try {
    const parsed = JSON.parse(result);
    console.error(`Deck: ${parsed.title} (${parsed.slideCount} slides)`);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}
