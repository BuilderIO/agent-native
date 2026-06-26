/**
 * Core script: resource-read
 *
 * Read a resource and output its content to stdout.
 *
 * Usage:
 *   pnpm action resource-read --path <path> [--scope personal|shared|workspace]
 */

import {
  resourceGetByPath,
  ensurePersonalDefaults,
  SHARED_OWNER,
  WORKSPACE_OWNER,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

export default async function resourceReadScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-read --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared|workspace
                           Scope to read from (default: personal, falls back to shared then workspace)
  --help                   Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path LEARNINGS.md");
  }

  const scope = parsed.scope;
  const owner = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;
  if (!owner) {
    fail(
      "resource-read requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }

  // Seed personal AGENTS.md + LEARNINGS.md on first access
  if (scope !== "shared" && scope !== "workspace") {
    await ensurePersonalDefaults(owner);
  }

  if (scope === "workspace") {
    const resource = await resourceGetByPath(WORKSPACE_OWNER, resourcePath);
    if (!resource) {
      console.log(
        `Resource not found: ${resourcePath} (scope: workspace). Workspace resources are managed from Dispatch.`,
      );
      return;
    }
    process.stdout.write(resource.content);
    return;
  }

  if (scope === "shared") {
    const resource = await resourceGetByPath(SHARED_OWNER, resourcePath);
    if (!resource) {
      console.log(
        `Resource not found: ${resourcePath} (scope: shared). You can create it with resource-write.`,
      );
      return;
    }
    process.stdout.write(resource.content);
    return;
  }

  // Default: try personal first, then app/organization shared, then workspace.
  const personal = await resourceGetByPath(owner, resourcePath);
  if (personal) {
    process.stdout.write(personal.content);
    return;
  }

  if (scope === "personal") {
    // Explicit personal scope — don't fall back
    console.log(
      `Resource not found: ${resourcePath} (scope: personal). You can create it with resource-write.`,
    );
    return;
  }

  const shared = await resourceGetByPath(SHARED_OWNER, resourcePath);
  if (shared) {
    process.stdout.write(shared.content);
    return;
  }

  const workspace = await resourceGetByPath(WORKSPACE_OWNER, resourcePath);
  if (workspace) {
    process.stdout.write(workspace.content);
    return;
  }

  console.log(
    `Resource not found: ${resourcePath}. You can create it with resource-write.`,
  );
}
