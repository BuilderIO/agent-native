/**
 * Core script: save-memory
 *
 * Create or update a structured memory entry and its index.
 * Stores memory as a resource at `memory/<name>.md` (personal scope)
 * and maintains a `memory/MEMORY.md` index.
 */

import { resourcePut, resourceGetByPath } from "../../resources/store.js";
import {
  getRequestRunContext,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

const VALID_TYPES = ["user", "feedback", "project", "reference"] as const;

const EMPTY_INDEX = `# Memory Index
`;

export default async function saveMemoryScript(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  const name = parsed.name;
  if (!name) fail("--name is required (e.g. 'coding-style', 'project-alpha')");

  const type = parsed.type;
  if (!type || !VALID_TYPES.includes(type as any)) {
    fail(`--type is required. Must be one of: ${VALID_TYPES.join(", ")}`);
  }

  const description = parsed.description;
  if (!description) fail("--description is required (one-line summary)");

  const content = parsed.content;
  if (!content) fail("--content is required");

  const owner = getRequestRunContext()?.owner ?? getRequestUserEmail();
  if (!owner) {
    fail(
      "save-memory requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }
  const memoryPath = `memory/${name}.md`;
  const indexPath = "memory/MEMORY.md";
  const now = new Date().toISOString().slice(0, 10);

  // Build the memory file with frontmatter
  const fileContent = `---
type: ${type}
description: ${description}
updated: ${now}
---

${content}`;

  // Write the memory file
  await resourcePut(owner, memoryPath, fileContent, "text/markdown");

  // Update the index
  let index: string;
  try {
    const existing = await resourceGetByPath(owner, indexPath);
    index = existing?.content ?? EMPTY_INDEX;
  } catch {
    index = EMPTY_INDEX;
  }

  // Parse existing entries (simple line-based: `- [name](file) — description`)
  const lines = index.split("\n");
  const entryLine = `- [${name}](${name}.md) — ${description}`;
  const entryPrefix = `- [${name}]`;

  // Find and replace or append
  let found = false;
  const updatedLines = lines.map((line) => {
    if (line.startsWith(entryPrefix)) {
      found = true;
      return entryLine;
    }
    return line;
  });

  if (!found) {
    // Append after the header
    updatedLines.push(entryLine);
  }

  const updatedIndex = updatedLines.join("\n").trimEnd() + "\n";

  // Check size
  const lineCount = updatedIndex.split("\n").length;
  if (lineCount > 200) {
    console.log(
      `Warning: Memory index has ${lineCount} lines (recommended: <200). Consider consolidating or removing old memories.`,
    );
  }

  await resourcePut(owner, indexPath, updatedIndex, "text/markdown");

  // Do not report success until both writes are visible through the resource
  // read path. This catches storage or ownership mismatches that would
  // otherwise leave the caller believing a memory was saved.
  const persistedMemory = await resourceGetByPath(owner, memoryPath);
  if (persistedMemory?.content !== fileContent) {
    fail(`save-memory could not verify persisted memory "${name}".`);
  }
  const persistedIndex = await resourceGetByPath(owner, indexPath);
  if (persistedIndex?.content !== updatedIndex) {
    fail("save-memory could not verify persisted memory index.");
  }

  console.log(`Saved memory "${name}" (${type}): ${description}`);
}
