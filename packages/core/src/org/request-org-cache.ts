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

const MEMBER_ORGS_TTL_MS = 15_000;

const processMemberships = createTtlCache<unknown[]>({
  ttlMs: MEMBER_ORGS_TTL_MS,
  maxEntries: 2_048,
});

export async function cachedMemberships<T>(
  email: string,
  load: () => Promise<T[] | null>,
): Promise<T[] | null> {
  const key = email.trim().toLowerCase();
  const hit = processMemberships.get(key);
  if (hit) return hit as T[];
  const rows = await load();
  if (rows !== null) processMemberships.set(key, rows as unknown[]);
  return rows;
}

export function invalidateMemberOrgCaches(): void {
  cacheForRequest(false)?.clear();
  processMemberships.clear();
}

export const ACTIVE_ORG_SETTING_KEY = "active-org-id";

export type ActiveOrgSetting = { orgId: string | null } | null;

/**
 * Rotated by every request that changes its caller's `active-org-id`, and part
 * of the cache key below. A browser that switched organizations carries the new
 * value on its next request, so every instance misses and reads the switch,
 * while an instance that still holds the previous answer serves it only to
 * requests that never saw the switch. The value selects a cache entry and
 * nothing else: a forged one can only cause a miss.
 */
export const ORG_SELECTION_COOKIE = "an_org_selection";
const ORG_SELECTION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function orgSelectionFromCookieHeader(
  header: string | null | undefined,
): string {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== ORG_SELECTION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return ORG_SELECTION_PATTERN.test(value) ? value : "";
  }
  return "";
}

/**
 * The `active-org-id` preference, held across requests for the same TTL as
 * the memberships it selects from, keyed by email and org selection. It only
 * chooses among memberships, so a stale value can never select an org the
 * caller no longer belongs to. `user-settings` invalidates this instance's
 * entries on every write to the key, and the generation check stops a read
 * that raced a write from caching the old value here.
 */
const processActiveOrgSettings = createTtlCache<ActiveOrgSetting>({
  ttlMs: MEMBER_ORGS_TTL_MS,
  maxEntries: 2_048,
});
let activeOrgSettingGeneration = 0;

export async function cachedActiveOrgSetting(
  email: string,
  orgSelection: string,
  load: () => Promise<ActiveOrgSetting>,
): Promise<ActiveOrgSetting> {
  const key = `${orgSelection}:${email.trim().toLowerCase()}`;
  const hit = processActiveOrgSettings.get(key);
  if (hit !== undefined) return hit;
  const generation = activeOrgSettingGeneration;
  const setting = await load();
  if (generation === activeOrgSettingGeneration) {
    processActiveOrgSettings.set(key, setting);
  }
  return setting;
}

export function invalidateActiveOrgSettingCache(): void {
  activeOrgSettingGeneration += 1;
  processActiveOrgSettings.clear();
}

export function __resetProcessMemberOrgCacheForTests(): void {
  processMemberships.clear();
  processActiveOrgSettings.clear();
}
