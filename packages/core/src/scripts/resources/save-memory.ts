/**
 * Core script: save-memory
 *
 * Create or update a structured memory entry and its index.
 * Stores memory in the selected private scope and maintains its index.
 */

import {
  resourceGetByPath,
  resourcePutSnapshotBatchIfCurrent,
  sharedResourceOwner,
  type ResourceSnapshotWriteOptions,
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

export type SaveMemoryEntry = {
  name: string;
  type: (typeof VALID_TYPES)[number];
  description: string;
  content: string;
};

export type SaveMemoryScriptOptions = ResourceSnapshotWriteOptions & {
  additionalEntries?: readonly SaveMemoryEntry[];
};

export default async function saveMemoryScript(
  args: string[],
  options?: SaveMemoryScriptOptions,
): Promise<void> {
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

  const entries: SaveMemoryEntry[] = [
    { name, type: type as SaveMemoryEntry["type"], description, content },
    ...(options?.additionalEntries ?? []),
  ];
  if (
    entries.some(
      (entry) =>
        !entry.name ||
        !VALID_TYPES.includes(entry.type) ||
        !entry.description ||
        !entry.content,
    ) ||
    new Set(entries.map((entry) => entry.name)).size !== entries.length
  ) {
    fail("save-memory requires complete entries with unique names.");
  }

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
  const memoryOwner = orgId ? sharedResourceOwner(orgId) : owner;
  const indexPath = "memory/MEMORY.md";
  const now = new Date().toISOString().slice(0, 10);

  const fileContents = entries.map(
    (entry) =>
      `---\ntype: ${entry.type}\ndescription: ${entry.description}\nupdated: ${now}\n---\n\n${entry.content}`,
  );

  let updatedIndex = "";
  let batchSaved = false;
  for (let attempt = 0; attempt < INDEX_WRITE_ATTEMPTS; attempt += 1) {
    const [existingIndex, ...existingMemories] = await Promise.all([
      resourceGetByPath(memoryOwner, indexPath, { orgId }),
      ...entries.map((entry) =>
        resourceGetByPath(memoryOwner, `memory/${entry.name}.md`, { orgId }),
      ),
    ]);
    const index = existingIndex?.content ?? EMPTY_INDEX;
    const entryLines = new Map(
      entries.map((entry) => [
        entry.name,
        `- [${entry.name}](${entry.name}.md) — ${entry.description}`,
      ]),
    );
    const found = new Set<string>();
    const updatedLines = index.split("\n").map((line) => {
      const entryName = /^- \[([^\]]+)\]/.exec(line)?.[1];
      const replacement = entryName ? entryLines.get(entryName) : undefined;
      if (!entryName || !replacement) return line;
      found.add(entryName);
      return replacement;
    });
    for (const entry of entries) {
      if (!found.has(entry.name))
        updatedLines.push(entryLines.get(entry.name)!);
    }
    updatedIndex = updatedLines.join("\n").trimEnd() + "\n";

    const writes = [
      ...entries.map((entry, index) => ({
        owner: memoryOwner,
        path: `memory/${entry.name}.md`,
        content: fileContents[index]!,
        mimeType: "text/markdown",
        previous: existingMemories[index] ?? null,
      })),
      {
        owner: memoryOwner,
        path: indexPath,
        content: updatedIndex,
        mimeType: "text/markdown",
        previous: existingIndex,
      },
    ];
    const written = await resourcePutSnapshotBatchIfCurrent(writes, {
      beforeWrite: options?.beforeWrite,
    });
    if (written) {
      if (
        written.length !== writes.length ||
        fileContents.some(
          (fileContent, index) =>
            written[index]?.resource.content !== fileContent,
        ) ||
        written.at(-1)?.resource.content !== updatedIndex
      ) {
        fail("save-memory could not verify the committed memory batch.");
      }
      batchSaved = true;
      break;
    }
  }
  if (!batchSaved) {
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

  // A later read can see a newer save; these are the committed snapshots.

  if (parsed.quiet !== "true") {
    for (const entry of entries) {
      console.log(
        `Saved memory "${entry.name}" (${entry.type}): ${entry.description}`,
      );
    }
  }
}
