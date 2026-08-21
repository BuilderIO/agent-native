import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { readPublicJsonAsset } from "./public-assets";

interface SourceEntry {
  path: string;
  content: string;
}

let cachedIndex: SourceEntry[] | null = null;

async function loadSourceIndex(): Promise<SourceEntry[]> {
  if (cachedIndex) return cachedIndex;
  const index = await readPublicJsonAsset<SourceEntry[]>("source-index.json");
  if (!Array.isArray(index)) return [];
  cachedIndex = index;
  return index;
}

export default defineAction({
  description:
    "Search framework source code files by keyword. Returns matching file paths with context snippets.",
  schema: z.object({
    query: z
      .string()
      .describe("Search pattern (substring match in file content)"),
    directory: z
      .string()
      .optional()
      .describe(
        "Subdirectory to scope search, e.g. 'server', 'client', 'agent'",
      ),
  }),
  http: false,
  readOnly: true,
  publicAgent: { expose: true, readOnly: true },
  run: async ({ query, directory }) => {
    const index = await loadSourceIndex();
    if (index.length === 0) {
      return "Source index not available. The source-index.json may not have been generated yet.";
    }

    const lower = query.toLowerCase();
    const matches = index.filter((entry) => {
      if (directory && !entry.path.startsWith(directory + "/")) return false;
      return (
        entry.path.toLowerCase().includes(lower) ||
        entry.content.toLowerCase().includes(lower)
      );
    });

    if (matches.length === 0) {
      return `No source files matched "${query}"${directory ? ` in ${directory}/` : ""}. Try a different search term.`;
    }

    return matches
      .slice(0, 15)
      .map((m) => {
        const lines = m.content.split("\n");
        const matchingLines = lines
          .map((line, i) => ({ line, num: i + 1 }))
          .filter((l) => l.line.toLowerCase().includes(lower))
          .slice(0, 3);

        const snippet = matchingLines.length
          ? matchingLines.map((l) => `  ${l.num}: ${l.line.trim()}`).join("\n")
          : `  1: ${lines[0]?.trim() || ""}`;

        return `**${m.path}**\n${snippet}`;
      })
      .join("\n\n");
  },
});
