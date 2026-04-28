/**
 * Server-side key substitution for automation tools.
 *
 * Resolves `${keys.NAME}` references in user-supplied strings (URLs, headers,
 * bodies, etc.) by looking up the named secret at tool-dispatch time. The
 * raw secret value NEVER enters the model's context — substitution happens
 * after the agent emits its tool call and before the request is dispatched.
 *
 * Falls back from user-scope to workspace-scope so users can override shared
 * keys without breaking automations that reference workspace defaults.
 */

import { readAppSecret, readAppSecretMeta } from "./storage.js";
import type { SecretScope } from "./register.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";

const KEY_REFERENCE_REGEX = /\$\{keys\.([A-Za-z0-9_-]+)\}/g;

export interface ResolveKeyReferencesResult {
  resolved: string;
  usedKeys: string[];
}

/**
 * Resolve `${keys.NAME}` references in `text`. For each reference, looks up
 * the named secret at the given scope, falling back to workspace-scope when
 * the user-scope row doesn't exist. Throws when a referenced key is missing
 * so the agent receives a clear error rather than dispatching with the
 * literal placeholder.
 */
export async function resolveKeyReferences(
  text: string,
  scope: SecretScope,
  scopeId: string,
): Promise<ResolveKeyReferencesResult> {
  const usedKeys: string[] = [];
  const matches = Array.from(text.matchAll(KEY_REFERENCE_REGEX));
  if (matches.length === 0) {
    return { resolved: text, usedKeys };
  }

  const resolutions = new Map<string, string>();
  for (const match of matches) {
    const name = match[1];
    if (resolutions.has(name)) continue;

    let result = await readAppSecret({ key: name, scope, scopeId });
    if (!result && scope === "user") {
      result = await readAppSecret({
        key: name,
        scope: "workspace",
        scopeId: getWorkspaceScopeId(scopeId),
      });
    }
    if (!result) {
      throw new Error(
        `Referenced key "${name}" is not defined for scope "${scope}". Create it in Settings or via the secrets API before using this automation.`,
      );
    }
    resolutions.set(name, result.value);
    usedKeys.push(name);
  }

  const resolved = text.replace(KEY_REFERENCE_REGEX, (_, name: string) => {
    const value = resolutions.get(name);
    if (value === undefined) {
      throw new Error(`Referenced key "${name}" was not resolved`);
    }
    return value;
  });

  return { resolved, usedKeys };
}

/**
 * Check if a URL is allowed by a key's URL allowlist. Returns true when no
 * allowlist is configured (permissive default — the allowlist is opt-in).
 *
 * Matching is exact on the URL's origin (scheme + host + port), so an entry
 * like `https://hooks.slack.com` blocks `https://evil.example.com` even if
 * the agent tries to redirect the request elsewhere.
 */
export function validateUrlAllowlist(
  url: string,
  allowlist: string[] | null,
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    try {
      return new URL(entry).origin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * Convenience helper: look up a key's allowlist by name+scope. Returns null
 * when the key doesn't exist or has no allowlist configured.
 */
export async function getKeyAllowlist(
  name: string,
  scope: SecretScope,
  scopeId: string,
): Promise<string[] | null> {
  let meta = await readAppSecretMeta({ key: name, scope, scopeId });
  if (!meta && scope === "user") {
    meta = await readAppSecretMeta({
      key: name,
      scope: "workspace",
      scopeId: getWorkspaceScopeId(scopeId),
    });
  }
  return meta?.urlAllowlist ?? null;
}

function getWorkspaceScopeId(userScopeId: string): string {
  const orgId = getRequestOrgId();
  if (orgId) return orgId;
  const email = getRequestUserEmail() || userScopeId;
  return `solo:${email}`;
}
