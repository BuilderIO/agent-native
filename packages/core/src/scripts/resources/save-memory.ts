/**
 * Core script: save-memory
 *
 * Create or update a structured memory entry and its index.
 * Stores memory privately under the current user and maintains its index.
 */

import { createHash } from "node:crypto";

import {
  resourceGetByPath,
  resourcePutSnapshotPairIfCurrent,
} from "../../resources/store.js";
import {
  getAmbientUserEmail,
  getRequestRunContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

const VALID_TYPES = ["user", "feedback", "project", "reference"] as const;

const EMPTY_INDEX = `# Memory Index
`;
const INDEX_WRITE_ATTEMPTS = 5;
const MEMORY_SCOPES = ["personal", "current-org"] as const;

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
  const scope = parsed.scope ?? "personal";
  if (!MEMORY_SCOPES.includes(scope as (typeof MEMORY_SCOPES)[number])) {
    fail(`--scope must be one of: ${MEMORY_SCOPES.join(", ")}`);
  }
  const orgId = scope === "current-org" ? getRequestOrgId() : null;
  if (scope === "current-org" && !orgId) {
    fail("--scope current-org requires an active organization.");
  }
  const memoryDirectory = orgId
    ? `memory/organizations/${createHash("sha256").update(orgId).digest("hex")}`
    : "memory";
  const memoryPath = `${memoryDirectory}/${name}.md`;
  const indexPath = `${memoryDirectory}/MEMORY.md`;
  const now = new Date().toISOString().slice(0, 10);

  // Build the memory file with frontmatter
  const fileContent = `---
type: ${type}
description: ${description}
updated: ${now}
---

${content}`;

  let updatedIndex = "";
  let indexSaved = false;
  for (let attempt = 0; attempt < INDEX_WRITE_ATTEMPTS; attempt += 1) {
    // Read both snapshots before the transaction so conflicts cannot leave a
    // new body paired with a stale index.
    const existingIndex = await resourceGetByPath(owner, indexPath);
    const existingMemory = await resourceGetByPath(owner, memoryPath);
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

    const written = await resourcePutSnapshotPairIfCurrent([
      {
        owner,
        path: memoryPath,
        content: fileContent,
        mimeType: "text/markdown",
        previous: existingMemory,
      },
      {
        owner,
        path: indexPath,
        content: updatedIndex,
        mimeType: "text/markdown",
        previous: existingIndex,
      },
    ]);
    if (written) {
      indexSaved = true;
      break;
    }
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
