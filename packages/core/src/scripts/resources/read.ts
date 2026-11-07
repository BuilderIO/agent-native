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
  const parts = resourcePath.split("/").filter(Boolean);
  if (parts[0] !== "skills" || !parts[1]) return;

  const flatSkill = parts.length === 2 && parts[1].endsWith(".md");
  const manifestPath = flatSkill ? resourcePath : `skills/${parts[1]}/SKILL.md`;
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

export const RESOURCE_READ_PAGE_CHARS = 40_000;

export class ResourceReadResultLimitError extends Error {}

function parseRangeArg(
  name: "offset" | "length",
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < (name === "length" ? 1 : 0)) {
    fail(
      `--${name} must be ${name === "length" ? "a positive" : "a non-negative"} integer.`,
    );
  }
  return n;
}

function isInsideSurrogatePair(content: string, offset: number): boolean {
  const previous = content.charCodeAt(offset - 1);
  const current = content.charCodeAt(offset);
  return (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

async function writeResource(
  resource: Resource,
  resourcePath: string,
  owner: string,
  orgId: string | null,
  range: { offset: number | undefined; length: number | undefined },
  maxResultChars: number,
): Promise<void> {
  await requireSkillLabAccess(resource, resourcePath, owner, orgId);
  const { content } = resource;
  const offset = range.offset ?? 0;
  const length = Math.min(
    range.length ?? RESOURCE_READ_PAGE_CHARS,
    RESOURCE_READ_PAGE_CHARS,
  );
  if (
    offset === 0 &&
    content.length <= length &&
    content.length <= maxResultChars
  ) {
    process.stdout.write(content);
    return;
  }
  if (offset >= content.length) {
    fail(
      `--offset ${offset} is past the end of "${resourcePath}" (${content.length} chars).`,
    );
  }
  if (isInsideSurrogatePair(content, offset)) {
    fail(
      `--offset ${offset} falls inside a surrogate pair in "${resourcePath}".`,
    );
  }
  let end = Math.min(offset + length, content.length);
  if (isInsideSurrogatePair(content, end)) {
    end += end - offset === 1 ? 1 : -1;
  }
  const header = (pageEnd: number) => {
    const status =
      pageEnd < content.length
        ? `partial - read again with offset=${pageEnd} for the rest`
        : "end of resource";
    return `[chars ${offset}-${pageEnd} of ${content.length}; ${status}]\n`;
  };
  if (header(end).length + end - offset > maxResultChars) {
    let low = offset + 1;
    let high = Math.min(end, content.length - 1);
    let fittingEnd = offset;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (header(mid).length + mid - offset <= maxResultChars) {
        fittingEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    end = fittingEnd;
    if (isInsideSurrogatePair(content, end)) end--;
    if (end === offset) {
      throw new ResourceReadResultLimitError(
        "Resource read result limit is too small for a page header and one character.",
      );
    }
  }
  process.stdout.write(header(end) + content.slice(offset, end));
}

export default async function resourceReadScript(
  args: string[],
  options: { maxResultChars?: number } = {},
): Promise<void> {
  const maxResultChars = options.maxResultChars ?? Infinity;
  if (
    maxResultChars !== Infinity &&
    (!Number.isSafeInteger(maxResultChars) || maxResultChars < 0)
  ) {
    throw new ResourceReadResultLimitError(
      "Invalid resource read result limit.",
    );
  }
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-read --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared|workspace
                           Scope to read from (default: personal, falls back to shared then workspace)
  --offset <n>             Start at this character (default: 0)
  --length <n>             Characters to return (max ${RESOURCE_READ_PAGE_CHARS}; larger resources are returned in pages)
  --help                   Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path LEARNINGS.md");
  }

  const range = {
    offset: parseRangeArg("offset", parsed.offset),
    length: parseRangeArg("length", parsed.length),
  };
  const scope = parsed.scope;
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
    if (!resource) {
      console.log(
        `Resource not found: ${resourcePath} (scope: workspace). Workspace resources are managed from Dispatch.`,
      );
      return;
    }
    await writeResource(
      resource,
      resourcePath,
      owner,
      orgId,
      range,
      maxResultChars,
    );
    return;
  }

  if (scope === "shared") {
    const orgId = getRequestOrgId() ?? null;
    const sharedOwner = sharedResourceOwner(orgId);
    const resource =
      (await resourceGetByPath(sharedOwner, resourcePath, { orgId })) ??
      (sharedOwner === SHARED_OWNER
        ? null
        : await resourceGetByPath(SHARED_OWNER, resourcePath, { orgId }));
    if (!resource) {
      console.log(
        `Resource not found: ${resourcePath} (scope: shared). You can create it with resource-write.`,
      );
      return;
    }
    await writeResource(
      resource,
      resourcePath,
      owner,
      orgId,
      range,
      maxResultChars,
    );
    return;
  }

  const personal = await resourceGetByPath(owner, resourcePath);
  if (personal) {
    await writeResource(
      personal,
      resourcePath,
      owner,
      getRequestOrgId() ?? null,
      range,
      maxResultChars,
    );
    return;
  }

  if (scope === "personal") {
    console.log(
      `Resource not found: ${resourcePath} (scope: personal). You can create it with resource-write.`,
    );
    return;
  }

  const orgId = getRequestOrgId() ?? null;
  const sharedOwner = sharedResourceOwner(orgId);
  const shared =
    (await resourceGetByPath(sharedOwner, resourcePath, { orgId })) ??
    (sharedOwner === SHARED_OWNER
      ? null
      : await resourceGetByPath(SHARED_OWNER, resourcePath, { orgId }));
  if (shared) {
    await writeResource(
      shared,
      resourcePath,
      owner,
      orgId,
      range,
      maxResultChars,
    );
    return;
  }

  const workspace = await resourceGetByPath(WORKSPACE_OWNER, resourcePath, {
    orgId,
  });
  if (workspace) {
    await writeResource(
      workspace,
      resourcePath,
      owner,
      orgId,
      range,
      maxResultChars,
    );
    return;
  }

  console.log(
    `Resource not found: ${resourcePath}. You can create it with resource-write.`,
  );
}
