import { getRequestContext } from "../server/request-context.js";

/**
 * Per-request memo of the `org_members` read behind `resolveOrgIdForEmail`,
 * keyed on the active AsyncLocalStorage `RequestContext` (WeakMap → freed with
 * the request) and then on the lowercased email. Mirrors the settings cache in
 * `settings/store.ts`.
 *
 * The `event.context` caches in `context.ts` only cover call chains that carry
 * an h3 event. Identity resolution for credential lookups, agent runs, A2A,
 * MCP, and adapter-authenticated action calls has no event, so every one of
 * those callers used to pay its own round trip for the same answer — on a
 * remote Postgres that is ~83ms each.
 *
 * TRAP: the key is the email, never "the current request's user". A single
 * request legitimately resolves several addresses (the signed-in caller plus a
 * run owner or credential subject), so a context-only key would answer one
 * identity with another's memberships.
 */
const requestOrgIds = new WeakMap<
  object,
  Map<string, Promise<string[] | null>>
>();

function cacheForRequest(
  create: boolean,
): Map<string, Promise<string[] | null>> | null {
  const ctx = getRequestContext();
  if (!ctx || typeof ctx !== "object") return null;
  let cache = requestOrgIds.get(ctx);
  if (!cache && create) {
    cache = new Map();
    requestOrgIds.set(ctx, cache);
  }
  return cache ?? null;
}

/**
 * Resolve the org ids `email` belongs to, once per request. `null` means the
 * membership rows were unreadable and is cached like any other answer; a
 * rejection is evicted so one transient failure cannot answer every later
 * lookup in the same request.
 */
export function requestMemberOrgIds(
  email: string,
  load: () => Promise<string[] | null>,
): Promise<string[] | null> {
  const cache = cacheForRequest(true);
  if (!cache) return load();
  const key = email.trim().toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = load().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Drop this request's memoized memberships after a write to `org_members`.
 * Clears every email rather than one: deleting an organization or removing a
 * member changes the answer for accounts other than the one being written.
 * Requests already in flight elsewhere keep their own snapshot for the rest of
 * their (short) lifetime, the same tradeoff the settings cache documents.
 */
export function invalidateRequestMemberOrgIds(): void {
  cacheForRequest(false)?.clear();
}
