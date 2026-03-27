/**
 * Core script: resource-read
 *
 * Read a resource and output its content to stdout.
 *
 * Usage:
 *   pnpm script resource-read --path <path> [--scope personal|shared]
 */

import { parseArgs, fail } from "../utils.js";
import { resourceGetByPath, SHARED_OWNER } from "../../resources/store.js";

export default async function resourceReadScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm script resource-read --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared  Scope to read from (default: personal, falls back to shared)
  --help                   Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path learnings.md");
  }

  const scope = parsed.scope;
  const owner = process.env.AGENT_USER_EMAIL ?? "local@localhost";

  if (scope === "shared") {
    const resource = await resourceGetByPath(SHARED_OWNER, resourcePath);
    if (!resource) {
      console.error(`Resource not found: ${resourcePath}`);
      process.exit(1);
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
    console.error(`Resource not found: ${resourcePath}`);
    process.exit(1);
  }

  const shared = await resourceGetByPath(SHARED_OWNER, resourcePath);
  if (shared) {
    process.stdout.write(shared.content);
    return;
  }

  console.error(`Resource not found: ${resourcePath}`);
  process.exit(1);
}
