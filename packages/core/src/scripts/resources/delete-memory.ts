/**
 * Core script: delete-memory
 *
 * Delete a memory entry and remove it from the index.
 */

import { parseArgs, fail } from "../utils.js";
import {
  resourcePut,
  resourceGetByPath,
  resourceDeleteByPath,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";

export default async function deleteMemoryScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  const name = parsed.name;
  if (!name) fail("--name is required (e.g. 'coding-style')");

  const owner = getRequestUserEmail() ?? "local@localhost";
  const memoryPath = `memory/${name}.md`;
  const indexPath = "memory/MEMORY.md";

  // Delete the memory file
  let deleted = false;
  try {
    await resourceDeleteByPath(owner, memoryPath);
    deleted = true;
  } catch {
    // May not exist
  }

  // Remove from index
  try {
    const existing = await resourceGetByPath(owner, indexPath);
    if (existing?.content) {
      const entryPrefix = `- [${name}]`;
      const lines = existing.content.split("\n");
      const filtered = lines.filter((line) => !line.startsWith(entryPrefix));
      if (filtered.length !== lines.length) {
        await resourcePut(
          owner,
          indexPath,
          filtered.join("\n").trimEnd() + "\n",
          "text/markdown",
        );
        deleted = true;
      }
    }
  } catch {
    // Index may not exist
  }

  if (deleted) {
    console.log(`Deleted memory "${name}".`);
  } else {
    console.log(`Memory "${name}" not found.`);
  }
}
