/**
 * Resource helpers for use in scripts.
 *
 * Scripts run inside an authenticated request context (set by the agent
 * runtime) or — in CLI-only contexts — read AGENT_USER_EMAIL. Both paths
 * require a real identity; there is no dev-mode fallback.
 */

import { getOrgRoleForEmail } from "../mcp/actions/service-token-access.js";
import { canManageOrg } from "../org/permissions.js";
import {
  getAmbientUserEmail,
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  SHARED_OWNER,
  WORKSPACE_OWNER,
  sharedResourceOwner,
  isLegacyOrganizationWorkspaceFile,
  resourceGetByPath,
  resourcePut,
  resourceDeleteByPath,
  resourceDeleteIfCurrent,
  resourceList,
  resourceListAccessible,
  resourceEffectiveContext,
  ensurePersonalDefaults,
  type ResourceMeta,
  type EffectiveResourceContext,
  type ResourceVisibility,
  type ResourceCreatedBy,
} from "./store.js";

type ResourceHelperScope = "personal" | "shared" | "workspace";

function getOwnerForScope(scope?: ResourceHelperScope): string {
  if (scope === "shared") return sharedResourceOwner(getRequestOrgId());
  if (scope === "workspace") return WORKSPACE_OWNER;
  const userEmail = getRequestUserEmail();
  if (userEmail) return userEmail;
  const cliEmail = getAmbientUserEmail();
  if (cliEmail) return cliEmail;
  throw new Error(
    "Resource access requires an authenticated request context or AGENT_USER_EMAIL env var",
  );
}

function resolveScope(options?: {
  shared?: boolean;
  scope?: ResourceHelperScope;
}): ResourceHelperScope {
  return options?.scope ?? (options?.shared ? "shared" : "personal");
}

async function assertCanManageSharedResource(): Promise<void> {
  const orgId = getRequestOrgId();
  if (!orgId) return;

  const email = getRequestUserEmail()?.trim() ?? getAmbientUserEmail()?.trim();
  const role = email ? await getOrgRoleForEmail(orgId, email) : null;
  if (!email || !canManageOrg(role)) {
    throw new Error(
      "Only organization owners and admins can edit organization files",
    );
  }
}

async function deleteSharedResource(path: string): Promise<boolean> {
  const orgId = getRequestOrgId() ?? null;
  const owner = sharedResourceOwner(orgId);
  if (owner === SHARED_OWNER) return resourceDeleteByPath(owner, path);

  const options = { orgId };
  const organizationResource = await resourceGetByPath(owner, path, options);
  if (organizationResource) {
    const deleted = await resourceDeleteIfCurrent(organizationResource);
    if (!deleted) return false;

    const legacy = await resourceGetByPath(SHARED_OWNER, path, options);
    if (legacy && isLegacyOrganizationWorkspaceFile(legacy, orgId)) {
      await resourceDeleteIfCurrent(legacy);
    }
    return true;
  }

  const legacy = await resourceGetByPath(SHARED_OWNER, path, options);
  return legacy && isLegacyOrganizationWorkspaceFile(legacy, orgId)
    ? resourceDeleteIfCurrent(legacy)
    : false;
}

export async function readResource(
  path: string,
  options?: { shared?: boolean; scope?: ResourceHelperScope },
): Promise<string | null> {
  const scope = resolveScope(options);
  const owner = getOwnerForScope(scope);
  const orgId = scope === "shared" ? getRequestOrgId() : undefined;
  const resourceOptions = orgId ? { orgId } : undefined;
  const resource = resourceOptions
    ? await resourceGetByPath(owner, path, resourceOptions)
    : await resourceGetByPath(owner, path);
  if (resource) return resource.content;
  if (scope === "shared" && owner !== SHARED_OWNER) {
    return (
      (await resourceGetByPath(SHARED_OWNER, path, resourceOptions))?.content ??
      null
    );
  }
  return null;
}

export async function writeResource(
  path: string,
  content: string,
  options?: {
    shared?: boolean;
    scope?: Exclude<ResourceHelperScope, "workspace">;
    mimeType?: string;
    visibility?: ResourceVisibility;
    createdBy?: ResourceCreatedBy;
    threadId?: string | null;
    runId?: string | null;
    expiresAt?: number | null;
    metadata?: string | Record<string, unknown> | null;
  },
): Promise<void> {
  const scope = resolveScope(options);
  if (scope === "shared") await assertCanManageSharedResource();
  const owner = getOwnerForScope(scope);
  const writeOptions = {
    visibility: options?.visibility,
    createdBy: options?.createdBy,
    threadId: options?.threadId,
    runId: options?.runId,
    expiresAt: options?.expiresAt,
    metadata: options?.metadata,
  };
  const hasWriteOptions = Object.values(writeOptions).some(
    (value) => value !== undefined,
  );
  if (hasWriteOptions) {
    await resourcePut(owner, path, content, options?.mimeType, writeOptions);
    return;
  }
  await resourcePut(owner, path, content, options?.mimeType);
}

export async function deleteResource(
  path: string,
  options?: {
    shared?: boolean;
    scope?: Exclude<ResourceHelperScope, "workspace">;
  },
): Promise<boolean> {
  const scope = resolveScope(options);
  if (scope === "shared") await assertCanManageSharedResource();
  const owner = getOwnerForScope(scope);
  return scope === "shared"
    ? deleteSharedResource(path)
    : resourceDeleteByPath(owner, path);
}

export async function listResources(
  prefix?: string,
  options?: {
    shared?: boolean;
    scope?: ResourceHelperScope;
    includeAgentScratch?: boolean;
  },
): Promise<ResourceMeta[]> {
  const scope = resolveScope(options);
  const owner = getOwnerForScope(scope);
  const orgId = scope === "shared" ? getRequestOrgId() : undefined;
  const resourceOptions =
    scope === "shared"
      ? orgId
        ? {
            ...(options?.includeAgentScratch
              ? { includeAgentScratch: true }
              : {}),
            orgId,
          }
        : options?.includeAgentScratch
          ? { includeAgentScratch: true }
          : undefined
      : options?.includeAgentScratch
        ? { includeAgentScratch: true }
        : undefined;
  const resources = resourceOptions
    ? resourceList(owner, prefix, resourceOptions)
    : resourceList(owner, prefix);
  const primary = await resources;
  if (scope !== "shared" || owner === SHARED_OWNER) {
    return primary;
  }
  const inherited = await resourceList(SHARED_OWNER, prefix, resourceOptions);
  const seen = new Set(primary.map((resource) => resource.path));
  return [
    ...primary,
    ...inherited.filter((resource) => !seen.has(resource.path)),
  ];
}

export async function listAllResources(
  prefix?: string,
  options?: { includeAgentScratch?: boolean },
): Promise<ResourceMeta[]> {
  const userEmail = getOwnerForScope("personal");
  const orgId = getRequestOrgId();
  return options?.includeAgentScratch
    ? resourceListAccessible(userEmail, prefix, {
        includeAgentScratch: true,
        ...(orgId ? { orgId } : {}),
      })
    : orgId
      ? resourceListAccessible(userEmail, prefix, { orgId })
      : resourceListAccessible(userEmail, prefix);
}

export async function getEffectiveResourceContext(
  path: string,
): Promise<EffectiveResourceContext> {
  const userEmail = getOwnerForScope("personal");
  await ensurePersonalDefaults(userEmail);
  const orgId = getRequestOrgId();
  return orgId
    ? resourceEffectiveContext(userEmail, path, { userEmail, orgId })
    : resourceEffectiveContext(userEmail, path);
}
