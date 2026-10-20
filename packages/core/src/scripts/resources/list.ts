import {
  resourceList,
  resourceListAccessible,
  ensurePersonalDefaults,
  isWorkspaceResourceOwner,
  SHARED_OWNER,
  WORKSPACE_OWNER,
  sharedResourceOwner,
} from "../../resources/store.js";
import {
  getAmbientUserEmail,
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
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
  const owner = getRequestUserEmail() ?? getAmbientUserEmail();
  if (!owner) {
    fail(
      "resource-list requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }

  if (scope !== "shared" && scope !== "workspace") {
    await ensurePersonalDefaults(owner);
  }

  let resources;
  if (scope === "personal") {
    resources = includeAgentScratch
      ? await resourceList(owner, prefix, { includeAgentScratch: true })
      : await resourceList(owner, prefix);
  } else if (scope === "shared") {
    const orgId = getRequestOrgId() ?? null;
    const sharedOwner = sharedResourceOwner(orgId);
    const resourceOptions = {
      ...(includeAgentScratch ? { includeAgentScratch: true } : {}),
      orgId,
    };
    const primary = await resourceList(sharedOwner, prefix, resourceOptions);
    if (sharedOwner === SHARED_OWNER) {
      resources = primary;
    } else {
      const inherited = await resourceList(
        SHARED_OWNER,
        prefix,
        resourceOptions,
      );
      const seen = new Set(primary.map((resource) => resource.path));
      resources = [
        ...primary,
        ...inherited.filter((resource) => !seen.has(resource.path)),
      ];
    }
  } else if (scope === "workspace") {
    const orgId = getRequestOrgId() ?? null;
    resources = includeAgentScratch
      ? await resourceList(WORKSPACE_OWNER, prefix, {
          includeAgentScratch: true,
          orgId,
        })
      : await resourceList(WORKSPACE_OWNER, prefix, { orgId });
  } else {
    const orgId = getRequestOrgId() ?? null;
    resources = includeAgentScratch
      ? await resourceListAccessible(owner, prefix, {
          includeAgentScratch: true,
          orgId,
        })
      : await resourceListAccessible(owner, prefix, { orgId });
  }

  if (format === "json") {
    console.log(JSON.stringify(resources, null, 2));
    return;
  }

  if (resources.length === 0) {
    console.log("No resources found.");
    return;
  }

  console.log(`Resources: ${resources.length}\n`);

  for (const r of resources) {
    const ownerLabel = isWorkspaceResourceOwner(r.owner)
      ? "[workspace]"
      : r.owner === SHARED_OWNER
        ? "[shared]"
        : `[${r.owner}]`;
    const sizeLabel = r.size != null ? ` (${r.size} bytes)` : "";
    console.log(`  ${r.path}  ${ownerLabel}${sizeLabel}  ${r.mimeType}`);
  }
}
