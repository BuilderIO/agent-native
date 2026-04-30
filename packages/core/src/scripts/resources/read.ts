/**
 * Core script: resource-read
 *
 * Read a resource and output its content to stdout.
 *
 * Usage:
 *   pnpm action resource-read --path <path> [--scope personal|shared]
 */

import { parseArgs, fail } from "../utils.js";
import {
  resourceGetByPath,
  ensurePersonalDefaults,
  SHARED_OWNER,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { DEV_MODE_USER_EMAIL } from "../../server/auth.js";

export default async function resourceReadScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-read --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared  Scope to read from (default: personal, falls back to shared)
  --help                   Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path LEARNINGS.md");
  }

  const scope = parsed.scope;
  const owner = getRequestUserEmail() ?? DEV_MODE_USER_EMAIL;

  // Seed personal AGENTS.md + LEARNINGS.md on first access
  if (scope !== "shared") {
    await ensurePersonalDefaults(owner);
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

  // Default: try personal first, fall back to shared
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

  console.log(
    `Resource not found: ${resourcePath}. You can create it with resource-write.`,
  );
}
