import { createTtlCache } from "../shared/ttl-cache.js";

/**
 * Cross-request cache for hosted workspace-app ACL decisions.
 *
 * Every authenticated `/_agent-native/*` and `/api/*` request on a hosted
 * workspace app asks the Dispatch registry whether the caller may use the app.
 * That is a network round trip per request, and a page load fires many of them
 * in parallel. Under that burst the registry slows down, and lookups that
 * cross the access-check timeout fail closed — callers who have access get a
 * 403 while the same endpoint returns 200 for a sibling request.
 *
 * Two layers, with separate jobs:
 *
 * 1. A {@link WorkspaceAppAccessDecisionStore} holds settled decisions across
 *    requests. The default is in-memory and process-local; install another
 *    implementation (Redis, a KV store, a shared table) with
 *    {@link setWorkspaceAppAccessDecisionStore} without touching the ACL code.
 * 2. An in-flight map collapses concurrent lookups for the same key onto one
 *    registry call. It holds promises, so it is always process-local and is
 *    not part of the replaceable store.
 *
 * ONLY allow decisions are stored. A deny may be a transient registry failure
 * (timeout, 5xx, malformed JSON — all fail closed), and caching it would turn
 * one blip into a TTL of lockout. Denies stay uncached and retryable.
 *
 * Staleness: a revoked share can keep authorizing for up to the TTL, because
 * the write usually happens in another process (Dispatch) that cannot reach
 * this cache. Keep the TTL short; it is the correctness bound, and
 * {@link invalidateWorkspaceAppAccessCache} covers same-process writes.
 */
export interface WorkspaceAppAccessDecisionStore {
  /** Cached decision for `key`, or `undefined` on a miss or expiry. */
  get(key: string): Promise<boolean | undefined> | boolean | undefined;
  set(key: string, allowed: boolean): Promise<void> | void;
  /** Drop every decision. Called after any write that can revoke access. */
  clear(): Promise<void> | void;
}

export interface WorkspaceAppAccessCacheKey {
  appId: string;
  email: string;
  orgId: string | null;
}

const WORKSPACE_APP_ACCESS_TTL_MS = 15_000;
const WORKSPACE_APP_ACCESS_MAX_ENTRIES = 4_096;

export function createInMemoryWorkspaceAppAccessDecisionStore(
  options: { ttlMs?: number; maxEntries?: number } = {},
): WorkspaceAppAccessDecisionStore {
  const cache = createTtlCache<boolean>({
    ttlMs: options.ttlMs ?? WORKSPACE_APP_ACCESS_TTL_MS,
    maxEntries: options.maxEntries ?? WORKSPACE_APP_ACCESS_MAX_ENTRIES,
  });
  return {
    get: (key) => cache.get(key),
    set: (key, allowed) => cache.set(key, allowed),
    clear: () => cache.clear(),
  };
}

let decisionStore: WorkspaceAppAccessDecisionStore =
  createInMemoryWorkspaceAppAccessDecisionStore();
const inFlight = new Map<string, Promise<boolean>>();
// Bumped on every invalidation so a lookup that started before a revoking
// write cannot store its now-stale allow after the cache was cleared.
let generation = 0;

/**
 * Replace the decision store, e.g. with a shared cache so every function
 * instance sees the same decisions. Pass `null` to restore the in-memory
 * default.
 */
export function setWorkspaceAppAccessDecisionStore(
  store: WorkspaceAppAccessDecisionStore | null,
): void {
  decisionStore = store ?? createInMemoryWorkspaceAppAccessDecisionStore();
  generation += 1;
  inFlight.clear();
}

/**
 * The email and org are part of the key on purpose: one process serves many
 * users, and the same user can hold different access in different orgs.
 */
function cacheKey({ appId, email, orgId }: WorkspaceAppAccessCacheKey): string {
  return JSON.stringify([appId, email, orgId ?? ""]);
}

async function readDecision(key: string): Promise<boolean | undefined> {
  try {
    return await decisionStore.get(key);
  } catch (error) {
    // coercion-ok: an unavailable cache is a miss; the registry stays the authority.
    console.error("[workspace-app-access] decision cache read failed", error);
    return undefined;
  }
}

async function writeDecision(key: string, allowed: boolean): Promise<void> {
  try {
    await decisionStore.set(key, allowed);
  } catch (error) {
    // coercion-ok: failing to cache must not change the decision just made.
    console.error("[workspace-app-access] decision cache write failed", error);
  }
}

/**
 * Resolve a workspace-app decision through the cache, calling `load` on a miss.
 * Concurrent callers for the same key share one `load`.
 */
export function cachedWorkspaceAppAccess(
  key: WorkspaceAppAccessCacheKey,
  load: () => Promise<boolean>,
): Promise<boolean> {
  const serialized = cacheKey(key);
  const pending = inFlight.get(serialized);
  if (pending) return pending;

  const startedAt = generation;
  const lookup = (async () => {
    if ((await readDecision(serialized)) === true) return true;
    const allowed = await load();
    if (allowed && startedAt === generation) {
      await writeDecision(serialized, true);
    }
    return allowed;
  })().finally(() => {
    if (inFlight.get(serialized) === lookup) inFlight.delete(serialized);
  });
  inFlight.set(serialized, lookup);
  return lookup;
}

/**
 * Drop cached decisions after a write that can revoke workspace-app access
 * (visibility, org enablement, shares). Clears every key: one write can change
 * the answer for every member of the org.
 */
export async function invalidateWorkspaceAppAccessCache(): Promise<void> {
  generation += 1;
  inFlight.clear();
  try {
    await decisionStore.clear();
  } catch (error) {
    console.error("[workspace-app-access] decision cache clear failed", error);
  }
}

/** Test seam — the store and in-flight map are module state. */
export function __resetWorkspaceAppAccessCacheForTests(): void {
  setWorkspaceAppAccessDecisionStore(null);
}
