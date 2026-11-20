import {
  MemoryDeleteFailedError,
  MemoryMirrorStaleError,
  MemoryTombstoneError,
  staleMirrorCollector,
} from "../../resources/shared-memory.js";
import {
  resourcePut,
  resourceGetByPath,
  resourceDeleteByPath,
} from "../../resources/store.js";
import {
  getAmbientUserEmail,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

export default async function deleteMemoryScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  const name = parsed.name;
  if (!name) fail("--name is required (e.g. 'coding-style')");

  const owner = getRequestUserEmail() ?? getAmbientUserEmail();
  if (!owner) {
    fail(
      "delete-memory requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }
  const memoryPath = `memory/${name}.md`;
  const indexPath = "memory/MEMORY.md";

  let deleted = false;
  let leftover: MemoryMirrorStaleError | undefined;
  try {
    deleted = await resourceDeleteByPath(owner, memoryPath);
  } catch (error) {
    if (error instanceof MemoryMirrorStaleError) {
      deleted = true;
      leftover = error;
    } else if (
      error instanceof MemoryTombstoneError ||
      error instanceof MemoryDeleteFailedError
    ) {
      fail(`Memory "${name}" was not deleted: ${error.message}`);
    } else throw error;
  }

  const stale = staleMirrorCollector();
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
        ).catch(stale.absorb);
        deleted = true;
      }
    }
  } catch (error) {
    console.log(
      `${deleted ? `Deleted memory "${name}"` : `Memory "${name}" not found`}, but the MEMORY.md index could not be updated: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  stale.finish();

  if (leftover) {
    console.log(
      `Deleted memory "${name}", but a leftover shared file remains: ${leftover.message}`,
    );
  } else if (deleted) {
    console.log(`Deleted memory "${name}".`);
  } else {
    console.log(`Memory "${name}" not found.`);
  }
}
