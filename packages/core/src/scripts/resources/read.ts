import { isLocalWorkspaceResourceId } from "../../local-artifacts/index.js";
import {
  SHARED_OWNER,
  resourceGetByPath,
  ensurePersonalDefaults,
  sharedResourceOwner,
  WORKSPACE_OWNER,
  type Resource,
} from "../../resources/store.js";
import { parseSkillFrontmatter } from "../../server/agent-chat/skill-frontmatter.js";
import {
  getAmbientUserEmail,
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

async function requireSkillLabAccess(
  resource: Resource,
  resourcePath: string,
  owner: string,
  orgId: string | null,
): Promise<void> {
  const parts = resource.path.split("/").filter(Boolean);
  if (parts[0] !== "skills" || !parts[1]) return;

  const flatSkill = parts.length === 2 && parts[1].endsWith(".md");
  const manifestPath = flatSkill
    ? resource.path
    : `skills/${parts[1]}/SKILL.md`;
  let manifest =
    resource.path === manifestPath
      ? resource
      : await resourceGetByPath(resource.owner, manifestPath, { orgId });
  if (!manifest) {
    const owners = [
      owner,
      sharedResourceOwner(orgId),
      SHARED_OWNER,
      WORKSPACE_OWNER,
    ];
    for (const candidate of new Set(owners)) {
      manifest = await resourceGetByPath(candidate, manifestPath, { orgId });
      if (manifest) break;
    }
  }
  const requiredLab = manifest
    ? parseSkillFrontmatter(manifest.content).requiresLab
    : undefined;
  if (!requiredLab) return;

  let enabledLabs: ReadonlySet<string>;
  try {
    const { getEnabledSkillLabsForUser } =
      await import("../../server/agents-bundle.js");
    enabledLabs = await getEnabledSkillLabsForUser([requiredLab], owner);
  } catch {
    fail(
      `Could not verify access to "${resourcePath}" because Lab settings are unavailable.`,
      { errorCode: "skill_lab_check_failed", statusCode: 503 },
    );
  }
  if (!enabledLabs.has(requiredLab)) {
    fail(
      `Cannot read "${resourcePath}": the skill requires the "${requiredLab}" Lab to be enabled.`,
      { errorCode: "skill_lab_required", statusCode: 403 },
    );
  }
}

async function checkResourceForRead(
  resource: Resource,
  resourcePath: string,
  owner: string,
  orgId: string | null,
): Promise<Resource> {
  await requireSkillLabAccess(resource, resourcePath, owner, orgId);
  return resource;
}

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
  const resource = await resolveResourceForRead(resourcePath, scope);
  if (resource) {
    process.stdout.write(resource.content);
    return;
  }
  if (scope === "workspace") {
    console.log(
      `Resource not found: ${resourcePath} (scope: workspace). Workspace resources are managed from Dispatch.`,
    );
    return;
  }
  if (scope === "shared") {
    console.log(
      `Resource not found: ${resourcePath} (scope: shared). You can create it with resource-write.`,
    );
    return;
  }
  if (scope === "personal") {
    console.log(
      `Resource not found: ${resourcePath} (scope: personal). You can create it with resource-write.`,
    );
    return;
  }
  console.log(
    `Resource not found: ${resourcePath}. You can create it with resource-write.`,
  );
}

export async function resolveResourceForRead(
  resourcePath: string,
  scope?: string,
): Promise<Resource | null> {
  const owner = getRequestUserEmail() ?? getAmbientUserEmail();
  if (!owner) {
    fail(
      "resource-read requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }

  if (scope !== "shared" && scope !== "workspace") {
    await ensurePersonalDefaults(owner);
  }

  if (scope === "workspace") {
    const orgId = getRequestOrgId() ?? null;
    const resource = await resourceGetByPath(WORKSPACE_OWNER, resourcePath, {
      orgId,
    });
    return resource
      ? checkResourceForRead(resource, resourcePath, owner, orgId)
      : null;
  }

  if (scope === "shared") {
    const orgId = getRequestOrgId() ?? null;
    const sharedOwner = sharedResourceOwner(orgId);
    const resource =
      (await resourceGetByPath(sharedOwner, resourcePath, { orgId })) ??
      (sharedOwner === SHARED_OWNER
        ? null
        : await resourceGetByPath(SHARED_OWNER, resourcePath, { orgId }));
    return resource
      ? checkResourceForRead(resource, resourcePath, owner, orgId)
      : null;
  }

  const personal = await resourceGetByPath(owner, resourcePath);
  if (personal) {
    return checkResourceForRead(
      personal,
      resourcePath,
      owner,
      getRequestOrgId() ?? null,
    );
  }

  if (scope === "personal") return null;

  const orgId = getRequestOrgId() ?? null;
  const sharedOwner = sharedResourceOwner(orgId);
  const shared =
    (await resourceGetByPath(sharedOwner, resourcePath, { orgId })) ??
    (sharedOwner === SHARED_OWNER
      ? null
      : await resourceGetByPath(SHARED_OWNER, resourcePath, { orgId }));
  if (shared) {
    return checkResourceForRead(shared, resourcePath, owner, orgId);
  }

  const workspace = await resourceGetByPath(WORKSPACE_OWNER, resourcePath, {
    orgId,
  });
  if (workspace) {
    return checkResourceForRead(workspace, resourcePath, owner, orgId);
  }

  return null;
}

interface ResourceTextRange {
  offset: number;
  limit: number;
}

export function validateResourceTextRange(args: {
  action: string;
  offset?: number;
  limit?: number;
}): ResourceTextRange | null {
  if (!("offset" in args) && !("limit" in args)) return null;
  const { offset, limit } = args;
  if (
    args.action !== "read" ||
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit <= 0
  ) {
    fail(
      "Resource ranges require action read, a nonnegative safe-integer offset and a positive safe-integer limit, supplied together as numbers.",
      {
        errorCode: "invalid_resource_range",
      },
    );
  }
  return { offset, limit };
}

const countFormat = new Intl.NumberFormat("en-US");

function footer(returned: number, total: number, next: number): string {
  return `\n\n${next === total ? "" : "..."}[Returned ${countFormat.format(returned)} characters; ${next === total ? "end of resource" : `${countFormat.format(total)} total; next offset ${countFormat.format(next)}`}]`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function formatResourceTextRange(
  resource: Resource,
  range: ResourceTextRange,
  maxResultChars: number,
): string {
  const { content } = resource;
  if (
    !resource.mimeType.startsWith("text/") &&
    resource.mimeType !== "application/json" &&
    !isLocalWorkspaceResourceId(resource.id)
  ) {
    if (content.length > maxResultChars) {
      fail("The result allowance cannot fit the complete Resource content.", {
        errorCode: "resource_range_budget_too_small",
      });
    }
    return content;
  }
  const { offset, limit } = range;
  const total = content.length;
  let start = Math.min(offset, total);
  if (
    start > 0 &&
    start < total &&
    isHighSurrogate(content.charCodeAt(start - 1)) &&
    isLowSurrogate(content.charCodeAt(start))
  ) {
    start--;
  }
  let requestedEnd = start + Math.min(limit, total - start);
  if (
    requestedEnd < total &&
    isHighSurrogate(content.charCodeAt(requestedEnd - 1)) &&
    isLowSurrogate(content.charCodeAt(requestedEnd))
  ) {
    requestedEnd =
      requestedEnd - 1 > start ? requestedEnd - 1 : requestedEnd + 1;
  }

  // Terminal footers are shorter: a complete page can fit when a smaller partial page cannot.
  if (requestedEnd === total) {
    const ending = footer(total - start, total, total);
    if (total - start + ending.length <= maxResultChars) {
      return content.slice(start) + ending;
    }
  }
  let end = start;
  let low = start + 1;
  let high = Math.min(requestedEnd, total - 1, start + maxResultChars);
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate =
      isHighSurrogate(content.charCodeAt(middle - 1)) &&
      isLowSurrogate(content.charCodeAt(middle))
        ? middle - 1
        : middle;
    const returned = candidate - start;
    if (
      returned + footer(returned, total, candidate).length <=
      maxResultChars
    ) {
      end = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (end === start) {
    fail(
      "The result allowance cannot fit a Resource range footer and useful text, or an empty terminal result.",
      {
        errorCode: "resource_range_budget_too_small",
      },
    );
  }
  return content.slice(start, end) + footer(end - start, total, end);
}
