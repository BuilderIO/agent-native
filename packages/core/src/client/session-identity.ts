import type { PrivateActionScope } from "../shared/private-action-scope.js";
import { SESSION_INVALIDATION_STORAGE_KEY } from "../shared/ssr-session-bootstrap.js";

let identity: string | null | undefined;
let organization: string | null | undefined;
let actor: string | null | undefined;
let email: string | null | undefined;
let privateScope: PrivateActionScope | undefined;
let scope = {};
const listeners = new Set<(value: string | null | undefined) => void>();
const scopeListeners = new Set<() => void>();
const invalidationListeners = new Set<() => void>();
let invalidationStorageWatched = false;

/**
 * The identity of the session this tab last read: a string when signed in,
 * `null` when known to be signed out (or signing out), `undefined` before the
 * first read. Kept apart from `use-session` so action fetches can read it
 * without depending on the session hook.
 */
export function currentSessionIdentity(): string | null | undefined {
  return identity;
}

/** A new token for every user, organization, authenticated-actor or email transition. */
export function currentSessionScope(): object {
  return scope;
}

/** Known browser-session scope, never inferred from an absent organization. */
export function currentPrivateActionScope(): PrivateActionScope | undefined {
  return privateScope;
}

function nonemptyScopeId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function subscribeSessionScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

export function recordSessionIdentity(
  value: string | null | undefined,
  orgId?: string | null,
  authUserId?: string | null,
  userEmail?: string | null,
): void {
  if (
    identity === value &&
    organization === orgId &&
    actor === authUserId &&
    email === userEmail
  )
    return;
  const identityChanged = identity !== value;
  identity = value;
  organization = orgId;
  actor = authUserId;
  email = userEmail;
  const knownEmail = nonemptyScopeId(userEmail)?.toLowerCase();
  const knownActor = nonemptyScopeId(authUserId);
  const knownOrg = orgId === null ? null : nonemptyScopeId(orgId);
  privateScope =
    nonemptyScopeId(value) && knownEmail && knownActor && knownOrg !== undefined
      ? Object.freeze({
          email: knownEmail,
          orgId: knownOrg,
          authUserId: knownActor,
        })
      : undefined;
  scope = {};
  for (const listener of [...scopeListeners]) {
    try {
      listener();
    } catch {
      // coercion-ok: scope already changed; one failed observer must not suppress other cancellations.
    }
  }
  if (identityChanged) {
    for (const listener of listeners) listener(value);
  }
}

/** Calls `listener` each time this tab's session identity changes. */
export function subscribeSessionIdentity(
  listener: (value: string | null | undefined) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tells this tab's invalidation subscribers that its session is changing,
 * before the session is read again. Other tabs hear of it through
 * `SESSION_INVALIDATION_STORAGE_KEY`.
 */
export function announceSessionInvalidated(): void {
  for (const listener of [...invalidationListeners]) listener();
}

/**
 * Calls `listener` each time this tab or another starts changing the session
 * (a sign-out, an organization switch), before it is read again. The session
 * identity alone misses an organization switch, which keeps the account.
 */
export function subscribeSessionInvalidation(listener: () => void): () => void {
  if (!invalidationStorageWatched && typeof window !== "undefined") {
    invalidationStorageWatched = true;
    window.addEventListener("storage", (event) => {
      if (event.key === SESSION_INVALIDATION_STORAGE_KEY) {
        announceSessionInvalidated();
      }
    });
  }
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

/**
 * Who a published session is and which org it acts in, as one comparable
 * string, or null once signed out.
 */
export type SessionScope = string | null;

let publishedListener: ((scope: SessionScope) => void) | undefined;

/**
 * Runs after the session resolver publishes a session it read, so a module the
 * resolver can't import (it imports the resolver) can act on a known sign-in,
 * a sign-out, or a switch to another account or org.
 */
export function onSessionIdentityPublished(
  listener: (scope: SessionScope) => void,
): void {
  publishedListener = listener;
}

export function notifySessionIdentityPublished(scope: SessionScope): void {
  publishedListener?.(scope);
}
