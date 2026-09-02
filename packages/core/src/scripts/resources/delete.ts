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
  isLegacyOrganizationWorkspaceFile,
  resourceDelete,
  resourceDeleteByPath,
  resourceGetByPath,
  SHARED_OWNER,
  sharedResourceOwner,
  WORKSPACE_OWNER,
} from "../../resources/store.js";
import {
  getAmbientUserEmail,
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

async function deleteSharedResource(resourcePath: string): Promise<boolean> {
  const orgId = getRequestOrgId() ?? null;
  const owner = sharedResourceOwner(orgId);
  if (owner === SHARED_OWNER) {
    return resourceDeleteByPath(owner, resourcePath);
  }

  const options = { orgId };
  const organizationResource = await resourceGetByPath(
    owner,
    resourcePath,
    options,
  );
  if (organizationResource) {
    const deleted = await resourceDeleteByPath(owner, resourcePath);
    if (!deleted) return false;

    const legacy = await resourceGetByPath(SHARED_OWNER, resourcePath, options);
    if (legacy && isLegacyOrganizationWorkspaceFile(legacy, orgId)) {
      await resourceDelete(legacy.id);
    }
    return true;
  }

  const legacy = await resourceGetByPath(SHARED_OWNER, resourcePath, options);
  return legacy && isLegacyOrganizationWorkspaceFile(legacy, orgId)
    ? resourceDeleteByPath(SHARED_OWNER, resourcePath)
    : false;
}

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
  let deleted: boolean;
  if (scope === "shared") {
    deleted = await deleteSharedResource(resourcePath);
  } else if (scope === "workspace") {
    deleted = await resourceDeleteByPath(WORKSPACE_OWNER, resourcePath);
  } else {
    const personalOwner = getRequestUserEmail() ?? getAmbientUserEmail();
    if (!personalOwner) {
      fail(
        "resource-delete --scope=personal requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
      );
    }
    deleted = await resourceDeleteByPath(personalOwner, resourcePath);
  }

  if (deleted) {
    console.log(`Deleted resource: ${resourcePath}`);
  } else {
    console.log(`Resource not found: ${resourcePath}`);
  }
}
