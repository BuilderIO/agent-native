import type { CredentialContext } from "@agent-native/core/credentials";
import {
  getCredentialContext,
  type RequestContext,
} from "@agent-native/core/server";

export function requireRequestCredentialContext(
  credentialKey: string,
): CredentialContext {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error(
      `Cannot resolve credential "${credentialKey}" outside a user request. ` +
        `Either run from a framework action (auto-wrapped) or call ` +
        `withRequestContextFromEvent(event, ...) at the top of your custom route.`,
    );
  }
  return ctx;
}

export function tryRequestCredentialContext(): CredentialContext | null {
  return getCredentialContext();
}

/**
 * Stable namespace for in-process/provider caches. Any cache whose payload
 * depends on a user's credential must include this namespace in the key, or a
 * warm server process can serve one tenant's provider data to another.
 */
export function credentialCacheScope(
  credentialKey = "credential cache",
): string {
  const ctx = requireRequestCredentialContext(credentialKey);
  return ctx.orgId ? `o:${ctx.orgId}` : `u:${ctx.userEmail}`;
}

export function scopedCredentialCacheKey(
  key: string,
  credentialKey = "credential cache",
): string {
  return `${credentialCacheScope(credentialKey)}:${key}`;
}

export type { RequestContext, CredentialContext };
