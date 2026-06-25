/**
 * Core script: resource-list
 *
 * List resources stored in the SQL resource store.
 *
 * Usage:
 *   pnpm action resource-list [--prefix <path>] [--scope personal|shared|workspace|all] [--format json|text] [--include-agent-scratch true]
 */

import {
  resourceList,
  resourceListAccessible,
  ensurePersonalDefaults,
  SHARED_OWNER,
  WORKSPACE_OWNER,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

export default async function resourceListScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-list [options]

Options:
  --prefix <path>              Filter by path prefix
  --scope personal|shared|workspace|all
                               Scope to list (default: all)
  --format json|text           Output format (default: text)
  --include-agent-scratch true Include hidden agent scratch files
  --help                       Show this help message`);
    return;
  }

  const prefix = parsed.prefix;
  const scope = parsed.scope ?? "all";
  const format = parsed.format ?? "text";
  const includeAgentScratch =
    parsed["include-agent-scratch"] === "true" ||
    parsed.includeAgentScratch === "true" ||
    parsed.includeScratch === "true";
  const owner = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;
  if (!owner) {
    fail(
      "resource-list requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }

  // Seed personal AGENTS.md + LEARNINGS.md on first access
  if (scope !== "shared" && scope !== "workspace") {
    await ensurePersonalDefaults(owner);
  }

  let resources;
  if (scope === "personal") {
    resources = includeAgentScratch
      ? await resourceList(owner, prefix, { includeAgentScratch: true })
      : await resourceList(owner, prefix);
  } else if (scope === "shared") {
    resources = includeAgentScratch
      ? await resourceList(SHARED_OWNER, prefix, { includeAgentScratch: true })
      : await resourceList(SHARED_OWNER, prefix);
  } else if (scope === "workspace") {
    resources = includeAgentScratch
      ? await resourceList(WORKSPACE_OWNER, prefix, {
          includeAgentScratch: true,
        })
      : await resourceList(WORKSPACE_OWNER, prefix);
  } else {
    resources = includeAgentScratch
      ? await resourceListAccessible(owner, prefix, {
          includeAgentScratch: true,
        })
      : await resourceListAccessible(owner, prefix);
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
    const ownerLabel =
      r.owner === WORKSPACE_OWNER
        ? "[workspace]"
        : r.owner === SHARED_OWNER
          ? "[shared]"
          : `[${r.owner}]`;
    const sizeLabel = r.size != null ? ` (${r.size} bytes)` : "";
    console.log(`  ${r.path}  ${ownerLabel}${sizeLabel}  ${r.mimeType}`);
  }
}
