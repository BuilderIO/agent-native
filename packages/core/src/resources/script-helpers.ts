/**
 * Resource helpers for use in scripts.
 *
 * Scripts run inside an authenticated request context (set by the agent
 * runtime) or — in CLI-only contexts — read AGENT_USER_EMAIL. Both paths
 * require a real identity; there is no dev-mode fallback.
 */

import { getRequestUserEmail } from "../server/request-context.js";
import {
  SHARED_OWNER,
  WORKSPACE_OWNER,
  resourceGetByPath,
  resourcePut,
  resourceDeleteByPath,
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
  if (scope === "shared") return SHARED_OWNER;
  if (scope === "workspace") return WORKSPACE_OWNER;
  const userEmail = getRequestUserEmail();
  if (userEmail) return userEmail;
  const cliEmail = process.env.AGENT_USER_EMAIL;
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

export async function readResource(
  path: string,
  options?: { shared?: boolean; scope?: ResourceHelperScope },
): Promise<string | null> {
  const owner = getOwnerForScope(resolveScope(options));
  const resource = await resourceGetByPath(owner, path);
  return resource ? resource.content : null;
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
  const owner = getOwnerForScope(resolveScope(options));
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
  const owner = getOwnerForScope(resolveScope(options));
  return resourceDeleteByPath(owner, path);
}

export async function listResources(
  prefix?: string,
  options?: {
    shared?: boolean;
    scope?: ResourceHelperScope;
    includeAgentScratch?: boolean;
  },
): Promise<ResourceMeta[]> {
  const owner = getOwnerForScope(resolveScope(options));
  return options?.includeAgentScratch
    ? resourceList(owner, prefix, { includeAgentScratch: true })
    : resourceList(owner, prefix);
}

export async function listAllResources(
  prefix?: string,
  options?: { includeAgentScratch?: boolean },
): Promise<ResourceMeta[]> {
  const userEmail = getOwnerForScope("personal");
  return options?.includeAgentScratch
    ? resourceListAccessible(userEmail, prefix, { includeAgentScratch: true })
    : resourceListAccessible(userEmail, prefix);
}

export async function getEffectiveResourceContext(
  path: string,
): Promise<EffectiveResourceContext> {
  const userEmail = getOwnerForScope("personal");
  await ensurePersonalDefaults(userEmail);
  return resourceEffectiveContext(userEmail, path);
}
