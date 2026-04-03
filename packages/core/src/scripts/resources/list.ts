/**
 * Core script: resource-list
 *
 * List resources stored in the SQL resource store.
 *
 * Usage:
 *   pnpm action resource-list [--prefix <path>] [--scope personal|shared|all] [--format json|text]
 */

import { parseArgs } from "../utils.js";
import {
  resourceList,
  resourceListAccessible,
  ensurePersonalDefaults,
  SHARED_OWNER,
} from "../../resources/store.js";

export default async function resourceListScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-list [options]

Options:
  --prefix <path>              Filter by path prefix
  --scope personal|shared|all  Scope to list (default: all)
  --format json|text           Output format (default: text)
  --help                       Show this help message`);
    return;
  }

  const prefix = parsed.prefix;
  const scope = parsed.scope ?? "all";
  const format = parsed.format ?? "text";
  const owner = process.env.AGENT_USER_EMAIL ?? "local@localhost";

  // Seed personal AGENTS.md + LEARNINGS.md on first access
  if (scope !== "shared") {
    await ensurePersonalDefaults(owner);
  }

  let resources;
  if (scope === "personal") {
    resources = await resourceList(owner, prefix);
  } else if (scope === "shared") {
    resources = await resourceList(SHARED_OWNER, prefix);
  } else {
    resources = await resourceListAccessible(owner, prefix);
  }

  if (format === "json") {
    console.log(JSON.stringify(resources, null, 2));
    return;
  }

  // Human-readable output
  if (resources.length === 0) {
    console.log("No resources found.");
    return;
  }

  console.log(`Resources: ${resources.length}\n`);

  for (const r of resources) {
    const ownerLabel = r.owner === SHARED_OWNER ? "[shared]" : `[${r.owner}]`;
    const sizeLabel = r.size != null ? ` (${r.size} bytes)` : "";
    console.log(`  ${r.path}  ${ownerLabel}${sizeLabel}  ${r.mimeType}`);
  }
}
