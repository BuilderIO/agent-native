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

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parseNonNegativeInt(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) fail(`--${name} must be a non-negative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`--${name} is too large.`);
  return parsed;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

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
  --limit <n>                  Page size (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})
  --offset <n>                 Number of resources to skip (default 0)
  --help                       Show this help message`);
    return;
  }

  const prefix = parsed.prefix;
  const scope = parsed.scope ?? "all";
  if (!["personal", "shared", "workspace", "all"].includes(scope)) {
    fail("--scope must be one of: personal, shared, workspace, all.");
  }
  const format = parsed.format ?? "text";
  const includeAgentScratch =
    parsed["include-agent-scratch"] === "true" ||
    parsed.includeAgentScratch === "true" ||
    parsed.includeScratch === "true";
  const requestedLimit = parseNonNegativeInt(
    "limit",
    parsed.limit,
    DEFAULT_LIMIT,
  );
  if (requestedLimit < 1) fail("--limit must be at least 1.");
  const limit = Math.min(requestedLimit, MAX_LIMIT);
  const offset = parseNonNegativeInt("offset", parsed.offset, 0);
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

  const sorted = [...resources].sort(
    (a, b) =>
      compareCodeUnits(a.path, b.path) || compareCodeUnits(a.owner, b.owner),
  );
  const total = sorted.length;
  const page = sorted.slice(offset, offset + limit);
  const nextOffset = offset + page.length < total ? offset + page.length : null;

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          resources: page,
          total,
          offset,
          limit,
          hasMore: nextOffset !== null,
          nextOffset,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (total === 0) {
    console.log("No resources found.");
    return;
  }

  if (page.length === 0) {
    console.log(`No resources at offset ${offset} (total ${total}).`);
    return;
  }

  console.log(`Resources ${offset + 1}-${offset + page.length} of ${total}\n`);

  for (const r of page) {
    const ownerLabel = isWorkspaceResourceOwner(r.owner)
      ? "[workspace]"
      : r.owner === SHARED_OWNER
        ? "[shared]"
        : `[${r.owner}]`;
    const sizeLabel = r.size != null ? ` (${r.size} bytes)` : "";
    console.log(`  ${r.path}  ${ownerLabel}${sizeLabel}  ${r.mimeType}`);
  }

  if (nextOffset !== null) {
    const filters = [
      prefix ? `--prefix '${prefix.replace(/'/g, "'\\''")}'` : "",
      `--scope ${scope}`,
      includeAgentScratch ? "--include-agent-scratch true" : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `\nMore resources remain (${total - nextOffset}). Next page: ${filters} --offset ${nextOffset} --limit ${limit}`,
    );
  }
}
