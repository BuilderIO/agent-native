/**
 * Core script: resource-delete
 *
 * Delete a resource from the SQL store.
 *
 * Usage:
 *   pnpm action resource-delete --path <path> [--scope personal|shared]
 */

import {
  canWriteLocalWorkspaceResourcePath,
  resourceDeleteByPath,
  SHARED_OWNER,
  WORKSPACE_OWNER,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

export default async function resourceDeleteScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-delete --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared|workspace
                           Scope to delete from (default: personal). Workspace is writable for local file mode control resources.
  --help                   Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path notes/todo.md");
  }

  const scope = parsed.scope ?? "personal";
  if (scope === "workspace") {
    if (!(await canWriteLocalWorkspaceResourcePath(resourcePath))) {
      fail(
        "Workspace resources are managed from Dispatch unless local file mode exposes this path. Writable local workspace paths are AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, and skills/.",
      );
    }
  }
  let owner: string;
  if (scope === "shared") {
    owner = SHARED_OWNER;
  } else if (scope === "workspace") {
    owner = WORKSPACE_OWNER;
  } else {
    const personalOwner = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;
    if (!personalOwner) {
      fail(
        "resource-delete --scope=personal requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
      );
    }
    owner = personalOwner;
  }

  const deleted = await resourceDeleteByPath(owner, resourcePath);
  if (deleted) {
    console.log(`Deleted resource: ${resourcePath}`);
  } else {
    console.log(`Resource not found: ${resourcePath}`);
  }
}
