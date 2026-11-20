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
  let indexError: string | undefined;
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
    indexError = error instanceof Error ? error.message : String(error);
  }

  let indexStale: string | undefined;
  if (indexError === undefined) {
    try {
      stale.finish();
    } catch (error) {
      if (!(error instanceof MemoryMirrorStaleError)) throw error;
      indexStale = error.message;
    }
  }

  const subject = deleted
    ? `Deleted memory "${name}"`
    : `Memory "${name}" not found`;
  const problems: string[] = [];
  if (leftover) {
    problems.push(`a leftover shared file remains: ${leftover.message}`);
  }
  if (indexError !== undefined) {
    problems.push(`the MEMORY.md index could not be updated: ${indexError}`);
  }
  if (indexStale !== undefined) {
    problems.push(
      `the MEMORY.md index was updated but its shared copy is stale: ${indexStale}`,
    );
  }
  if (problems.length > 0) {
    console.log(`${subject}, but ${problems.join(", and ")}`);
    fail(`Memory "${name}" cleanup was incomplete; see the output above.`);
  } else if (deleted) {
    console.log(`Deleted memory "${name}".`);
  } else {
    console.log(`Memory "${name}" not found.`);
  }
}
