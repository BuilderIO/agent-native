/**
 * Core script: save-memory
 *
 * Create or update a structured memory entry and its index.
 * Stores memory as a resource at `memory/<name>.md` (personal scope)
 * and maintains a `memory/MEMORY.md` index.
 */

import {
  resourceGetByPath,
  resourcePut,
  resourcePutIfSnapshot,
} from "../../resources/store.js";
import {
  getAmbientUserEmail,
  getRequestRunContext,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

const VALID_TYPES = ["user", "feedback", "project", "reference"] as const;

const EMPTY_INDEX = `# Memory Index
`;
const INDEX_WRITE_ATTEMPTS = 5;

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

  const owner =
    getRequestRunContext()?.owner ??
    getRequestUserEmail() ??
    getAmbientUserEmail();
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

  // Read the index before either write so a failed read cannot replace it.
  let existingIndex = await resourceGetByPath(owner, indexPath);
  await resourcePut(owner, memoryPath, fileContent, "text/markdown");

  let updatedIndex = "";
  let indexSaved = false;
  for (let attempt = 0; attempt < INDEX_WRITE_ATTEMPTS; attempt += 1) {
    const index = existingIndex?.content ?? EMPTY_INDEX;
    const lines = index.split("\n");
    const entryLine = `- [${name}](${name}.md) — ${description}`;
    const entryPrefix = `- [${name}]`;
    let found = false;
    const updatedLines = lines.map((line) => {
      if (line.startsWith(entryPrefix)) {
        found = true;
        return entryLine;
      }
      return line;
    });
    if (!found) updatedLines.push(entryLine);
    updatedIndex = updatedLines.join("\n").trimEnd() + "\n";

    const written = await resourcePutIfSnapshot({
      owner,
      path: indexPath,
      content: updatedIndex,
      mimeType: "text/markdown",
      previous: existingIndex,
    });
    if (written) {
      indexSaved = true;
      break;
    }
    existingIndex = await resourceGetByPath(owner, indexPath);
  }
  if (!indexSaved) {
    fail(
      "Memory index changed repeatedly while saving; retry the memory write.",
    );
  }

  const lineCount = updatedIndex.split("\n").length;
  if (lineCount > 200) {
    console.log(
      `Warning: Memory index has ${lineCount} lines (recommended: <200). Consider consolidating or removing old memories.`,
    );
  }

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

  if (parsed.quiet !== "true") {
    console.log(`Saved memory "${name}" (${type}): ${description}`);
  }
}
