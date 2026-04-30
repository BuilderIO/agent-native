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
import {
  getRequestUserEmail,
  hasRequestContext,
} from "../server/request-context.js";

// Dev-mode fallback identity. Scripts run as standalone CLI processes
// without HTTP context — when no AGENT_USER_EMAIL is set we fall back to
// the dev-mode user so a developer running `pnpm action` locally without
// signing in still gets a usable scope. Production multi-user deployments
// always set AGENT_USER_EMAIL via the agent runtime.
import { DEV_MODE_USER_EMAIL } from "../server/auth.js";

function getOwner(shared?: boolean): string {
  if (shared) return SHARED_OWNER;
  const userEmail = getRequestUserEmail();
  if (userEmail) return userEmail;
  if (hasRequestContext()) {
    throw new Error(
      "Resource access requires an authenticated request context",
    );
  }
  return DEV_MODE_USER_EMAIL;
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
  const userEmail = getOwner(false);
  return resourceListAccessible(userEmail, prefix);
}
