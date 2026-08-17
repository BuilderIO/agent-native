import { getRequestContext } from "../server/request-context.js";
import { createTtlCache } from "../shared/ttl-cache.js";

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
 * Cross-request cache for the full membership rows behind `getOrgContext`.
 *
 * The per-request memo above only collapses repeated reads inside ONE request.
 * Every authenticated request still paid its own `org_members` round trip, and
 * production showed 494,785 of them — one per request, 1:1 with the session
 * lookup, for memberships that change on the order of days.
 *
 * Only a SUCCESSFUL read is stored. `loadMemberships` returns `null` for an
 * unreadable `org_members` (no such table on a template that skips the org
 * module, a role without SELECT); caching that would turn a permissions blip
 * into a minute of silently org-less requests, which drops org scope and hides
 * every org-scoped credential behind a permanent-sounding "not configured".
 */
const MEMBER_ORGS_TTL_MS = 15_000;

const processMemberships = createTtlCache<unknown[]>({
  ttlMs: MEMBER_ORGS_TTL_MS,
  maxEntries: 2_048,
});

/**
 * Read `email`'s memberships through the process cache, falling back to `load`.
 *
 * `load` returning `null`/empty-on-failure is the caller's contract to signal
 * "unreadable"; pass `cacheable: false` for such a result and it is not stored.
 */
export async function cachedMemberships<T>(
  email: string,
  load: () => Promise<T[] | null>,
): Promise<T[] | null> {
  const key = email.trim().toLowerCase();
  const hit = processMemberships.get(key);
  if (hit) return hit as T[];
  const rows = await load();
  // `null` is "unreadable", never "no memberships" — see the doc comment above.
  if (rows !== null) processMemberships.set(key, rows as unknown[]);
  return rows;
}

/**
 * Drop the memoized memberships after a write to `org_members`, in BOTH the
 * per-request memo and the cross-request cache.
 *
 * Clears every email rather than one: deleting an organization or removing a
 * member changes the answer for accounts other than the one being written.
 * Requests already in flight elsewhere keep their own snapshot for the rest of
 * their (short) lifetime, the same tradeoff the settings cache documents.
 *
 * Every membership write must route through here. A caller that clears only the
 * request memo leaves the process cache serving the pre-write answer for the
 * rest of the TTL — the user joins an org and the app keeps insisting they
 * haven't.
 *
 * "Membership write" is wider than `INSERT`/`DELETE org_members`: the cached
 * rows are a JOIN, so `org_members.role` and the `organizations.name` /
 * `organizations.allowed_domain` columns it selects are cached too. Demoting an
 * admin, renaming an org, or turning domain-join on without calling this keeps
 * the pre-write answer authorizing and rendering requests until the TTL lapses.
 */
export function invalidateMemberOrgCaches(): void {
  cacheForRequest(false)?.clear();
  processMemberships.clear();
}

/** Test seam — the process cache is module state, so suites must clear it. */
export function __resetProcessMemberOrgCacheForTests(): void {
  processMemberships.clear();
}
