/**
 * Core script: resource-delete
 *
 * Delete a resource from the SQL store.
 *
 * Usage:
 *   pnpm action resource-delete --path <path> [--scope personal|shared]
 */

import { parseArgs, fail } from "../utils.js";
import { resourceDeleteByPath, SHARED_OWNER } from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";

export default async function resourceDeleteScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-delete --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared  Scope to delete from (default: personal)
  --help                   Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path notes/todo.md");
  }

  const scope = parsed.scope ?? "personal";
  const owner =
    scope === "shared"
      ? SHARED_OWNER
      : (getRequestUserEmail() ?? "local@localhost");

  const deleted = await resourceDeleteByPath(owner, resourcePath);
  if (deleted) {
    console.log(`Deleted resource: ${resourcePath}`);
  } else {
    console.log(`Resource not found: ${resourcePath}`);
  }
}
