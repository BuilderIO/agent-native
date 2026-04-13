/**
 * Resource helpers for use in scripts.
 *
 * Scripts run as standalone processes without HTTP context.
 * The owner is resolved from the AGENT_USER_EMAIL env var
 * (set by the agent runtime for multi-user apps), defaulting to
 * "local@localhost" for backward compatibility in dev mode.
 */

import {
  SHARED_OWNER,
  resourceGetByPath,
  resourcePut,
  resourceDeleteByPath,
  resourceList,
  resourceListAccessible,
  type ResourceMeta,
} from "./store.js";
import { getRequestUserEmail } from "../server/request-context.js";

function getOwner(shared?: boolean): string {
  if (shared) return SHARED_OWNER;
  return getRequestUserEmail() || "local@localhost";
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
  options?: { shared?: boolean; mimeType?: string },
): Promise<void> {
  const owner = getOwner(options?.shared);
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
  options?: { shared?: boolean },
): Promise<ResourceMeta[]> {
  const owner = getOwner(options?.shared);
  return resourceList(owner, prefix);
}

export async function listAllResources(
  prefix?: string,
): Promise<ResourceMeta[]> {
  const userEmail = getRequestUserEmail() || "local@localhost";
  return resourceListAccessible(userEmail, prefix);
}
