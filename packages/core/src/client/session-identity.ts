import { SESSION_INVALIDATION_STORAGE_KEY } from "../shared/ssr-session-bootstrap.js";

let identity: string | null | undefined;
const listeners = new Set<(value: string | null | undefined) => void>();
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

export function recordSessionIdentity(value: string | null | undefined): void {
  if (value === identity) return;
  identity = value;
  for (const listener of listeners) listener(value);
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
