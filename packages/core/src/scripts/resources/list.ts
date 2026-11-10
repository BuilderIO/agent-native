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

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export default async function resourceListScript(
  args: string[],
): Promise<void> {
  const parsed: Partial<Record<string, string>> = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-list [options]

Options:
  --prefix <path>              Filter by path prefix
  --scope personal|shared|workspace|all
                               Scope to list (default: all)
  --format json|text           Output format (default: text)
  --include-agent-scratch true Include hidden agent scratch files
  --limit <n>                  Resources per page, 1-${MAX_PAGE_SIZE} (default: ${DEFAULT_PAGE_SIZE}).
                               Text output always pages; json pages only
                               when --limit or --offset is set
  --offset <n>                 Resources to skip; pass the previous page's
                               next offset
  --help                       Show this help message`);
    return;
  }

  const limitArg = parsed.limit;
  const offsetArg = parsed.offset;
  if (
    limitArg !== undefined &&
    !(/^\d+$/.test(limitArg) && +limitArg >= 1 && +limitArg <= MAX_PAGE_SIZE)
  ) {
    fail(`--limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  }
  if (offsetArg !== undefined && !/^\d+$/.test(offsetArg)) {
    fail("--offset must be a whole number, 0 or more");
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

  // Agents read this through tool-result caps (12,000 chars when replayed), so
  // text always pages and json pages when asked. Sorting the merged list keeps
  // pages stable across calls.
  resources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paged =
    format !== "json" || limitArg !== undefined || offsetArg !== undefined;
  const total = resources.length;
  const offset = Number(offsetArg ?? 0);
  const limit = Number(limitArg ?? DEFAULT_PAGE_SIZE);
  const page = paged ? resources.slice(offset, offset + limit) : resources;
  const nextOffset = offset + page.length < total ? offset + page.length : null;

  if (format === "json") {
    console.log(
      JSON.stringify(
        paged
          ? {
              total,
              offset,
              limit,
              hasMore: nextOffset !== null,
              nextOffset,
              resources: page,
            }
          : resources,
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
    console.log(`No resources at offset ${offset} (${total} total).`);
    return;
  }

  // The next offset leads the header too: truncation cuts from the end.
  const whole = page.length === total;
  const range = whole
    ? ""
    : ` (showing ${offset + 1}-${offset + page.length}${nextOffset === null ? "" : `; next offset=${nextOffset}`})`;
  console.log(`Resources: ${total}${range}\n`);

  for (const r of page) {
    const ownerLabel = isWorkspaceResourceOwner(r.owner)
      ? "[workspace]"
      : r.owner === SHARED_OWNER
        ? "[shared]"
        : `[${r.owner}]`;
    const sizeLabel = r.size != null ? ` (${r.size} bytes)` : "";
    console.log(`  ${r.path}  ${ownerLabel}${sizeLabel}  ${r.mimeType}`);
  }

  if (whole) return;
  console.log(
    nextOffset === null
      ? "\nEnd of list."
      : `\n${total - nextOffset} more not shown. Next page: repeat this call with offset=${nextOffset}.`,
  );
}
