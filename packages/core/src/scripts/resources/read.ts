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

async function writeResource(
  resource: Resource,
  resourcePath: string,
  owner: string,
  orgId: string | null,
): Promise<void> {
  await requireSkillLabAccess(resource, resourcePath, owner, orgId);
  process.stdout.write(resource.content);
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
    await writeResource(resource, resourcePath, owner, orgId);
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
    await writeResource(resource, resourcePath, owner, orgId);
    return;
  }

  const personal = await resourceGetByPath(owner, resourcePath);
  if (personal) {
    await writeResource(
      personal,
      resourcePath,
      owner,
      getRequestOrgId() ?? null,
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
    await writeResource(shared, resourcePath, owner, orgId);
    return;
  }

  const workspace = await resourceGetByPath(WORKSPACE_OWNER, resourcePath, {
    orgId,
  });
  if (workspace) {
    await writeResource(workspace, resourcePath, owner, orgId);
    return;
  }

  console.log(
    `Resource not found: ${resourcePath}. You can create it with resource-write.`,
  );
}
