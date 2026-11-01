let identity: string | null | undefined;

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
  identity = value;
}

let publishedListener: (() => void) | undefined;

/**
 * Runs after the session resolver publishes a session it read, so a module the
 * resolver can't import (it imports the resolver) can act on a known sign-in.
 */
export function onSessionIdentityPublished(listener: () => void): void {
  publishedListener = listener;
}

export function notifySessionIdentityPublished(): void {
  publishedListener?.();
}
