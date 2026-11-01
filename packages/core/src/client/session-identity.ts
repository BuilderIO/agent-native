let identity: string | null | undefined;
const listeners = new Set<(value: string | null | undefined) => void>();

/**
 * The localStorage key a tab writes when its session changes (a sign-out, an
 * organization switch), so other tabs read their session again.
 */
export const SESSION_INVALIDATION_STORAGE_KEY =
  "agent-native:session-invalidated";

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
