import { createTtlCache } from "../shared/ttl-cache.js";

/**
 * Cross-request cache for resolved legacy session tokens.
 *
 * A session token is immutable for its (30-day) lifetime, yet every
 * authenticated request re-read it: production showed 494,848 of these for 3
 * users, 1:1 with the request count. The TTL is far shorter than the session
 * lifetime, so expiry is enforced at most `SESSION_EMAIL_TTL_MS` late — a 30-day
 * boundary observed up to 15s late changes nothing.
 *
 * ONLY successful resolutions belong in here. A `null` — no such token, expired,
 * revoked — must stay uncached so a sign-out or a token that has just been
 * written is never answered from a stale negative, and so an auth failure can
 * never be made sticky by a cache.
 *
 * Lives in its own module rather than in `auth.ts` because `auth.ts` imports
 * `org/auth-policy.ts`, which also revokes sessions and so needs to invalidate
 * this. Importing back into `auth.ts` from there would be a cycle.
 */
const SESSION_EMAIL_TTL_MS = 15_000;

const sessionEmailCache = createTtlCache<string>({
  ttlMs: SESSION_EMAIL_TTL_MS,
  maxEntries: 4_096,
});

export function getCachedSessionEmail(token: string): string | undefined {
  return sessionEmailCache.get(token);
}

export function setCachedSessionEmail(token: string, email: string): void {
  sessionEmailCache.set(token, email);
}

export function forgetCachedSessionEmail(token: string): void {
  sessionEmailCache.delete(token);
}

/**
 * Drop cached session resolutions. Call after ANY write to `sessions`.
 *
 * Clears every token rather than one: the bulk sign-out paths delete by email
 * (`DELETE FROM sessions WHERE email = ?`) and do not know which tokens they
 * removed, so a per-token eviction there would leave a signed-out session
 * resolving for the rest of the TTL.
 */
export function invalidateSessionEmailCache(): void {
  sessionEmailCache.clear();
}

/** Test seam — the cache is module state, so suites must be able to clear it. */
export function __resetSessionEmailCacheForTests(): void {
  sessionEmailCache.clear();
}
