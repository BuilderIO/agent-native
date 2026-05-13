/**
 * Resource helpers for use in scripts.
 *
 * Scripts run inside an authenticated request context (set by the agent
 * runtime) or — in CLI-only contexts — read AGENT_USER_EMAIL. Both paths
 * require a real identity; there is no dev-mode fallback.
 */

import {
  SHARED_OWNER,
  resourceGetByPath,
  resourcePut,
  resourceDeleteByPath,
  resourceList,
  resourceListAccessible,
  type ResourceMeta,
  type ResourceVisibility,
  type ResourceCreatedBy,
} from "./store.js";
import { getRequestUserEmail } from "../server/request-context.js";

function getOwner(shared?: boolean): string {
  if (shared) return SHARED_OWNER;
  const userEmail = getRequestUserEmail();
  if (userEmail) return userEmail;
  const cliEmail = process.env.AGENT_USER_EMAIL;
  if (cliEmail) return cliEmail;
  throw new Error(
    "Resource access requires an authenticated request context or AGENT_USER_EMAIL env var",
  );
}

export async function readResource(
  path: string,
  options?: { shared?: boolean },
): Promise<string | null> {
  const owner = getOwner(options?.shared);
  const resource = await resourceGetByPath(owner, path);
  return resource ? resource.content : null;
}

export async function writeResource(
  path: string,
  content: string,
  options?: {
    shared?: boolean;
    mimeType?: string;
    visibility?: ResourceVisibility;
    createdBy?: ResourceCreatedBy;
    threadId?: string | null;
    runId?: string | null;
    expiresAt?: number | null;
    metadata?: string | Record<string, unknown> | null;
  },
): Promise<void> {
  const owner = getOwner(options?.shared);
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
  options?: { shared?: boolean },
): Promise<boolean> {
  const owner = getOwner(options?.shared);
  return resourceDeleteByPath(owner, path);
}

export async function listResources(
  prefix?: string,
  options?: { shared?: boolean; includeAgentScratch?: boolean },
): Promise<ResourceMeta[]> {
  const owner = getOwner(options?.shared);
  return options?.includeAgentScratch
    ? resourceList(owner, prefix, { includeAgentScratch: true })
    : resourceList(owner, prefix);
}

export async function listAllResources(
  prefix?: string,
  options?: { includeAgentScratch?: boolean },
): Promise<ResourceMeta[]> {
  const userEmail = getOwner(false);
  return options?.includeAgentScratch
    ? resourceListAccessible(userEmail, prefix, { includeAgentScratch: true })
    : resourceListAccessible(userEmail, prefix);
}
