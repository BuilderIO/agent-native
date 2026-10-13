import {
  persistQueryClient,
  type Persister,
  type PersistedClient,
} from "@tanstack/query-persist-client-core";
import {
  IsRestoringProvider,
  useQueryClient,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import {
  clear as clearStore,
  createStore,
  del as deleteEntry,
  get as getEntry,
  keys as listKeys,
  set as setEntry,
} from "idb-keyval";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { AuthSession } from "../server/auth.js";
import { actionErrorStatus } from "./action-failure-circuit.js";
import { clientBuildId } from "./build-compatibility.js";
import {
  getAccessDeniedActionQueryBinding,
  isBrowserPersistableActionQueryForBinding,
  markRestoredBrowserPersistableActionQuery,
  registerActionQueryCacheRevoker,
  revokeBrowserPersistableActionQuery,
  setActionQueryCacheBindingToken,
} from "./use-action.js";
import { isSessionFromFirstRead, useSession } from "./use-session.js";

// Bump when a cached result's shape or meaning changes. A record stored under
// another buster is discarded on restore instead of being hydrated.
const ACTION_QUERY_CACHE_BUSTER = "action-query-cache-v1";
const ACTION_QUERY_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
// Every cache event dehydrates the whole client, so writes are coalesced to one
// per window instead of one per fetch state change.
const WRITE_DELAY_MS = 1_000;
// Restoring holds every query, so a store that never answers must not hold
// the app.
const RESTORE_TIMEOUT_MS = 2_000;
const INITIAL_CLEAR_TIMEOUT_MS = 2_000;
const BIND_WAIT_BUDGET_MS = 2_000;
const ACTION_QUERY_KEY = ["action"];

function isAccessDeniedActionQuery(query: Query): boolean {
  if (query.queryKey[0] !== "action") return false;
  const status = actionErrorStatus(query.state.error);
  return status === 401 || status === 403 || status === 404;
}

function clearAccessDeniedActionQueryData(query: Query): void {
  query.setState({ data: undefined, dataUpdatedAt: 0 });
}

export interface ActionQueryCacheStorage {
  get(key: string): Promise<PersistedClient | undefined>;
  set(key: string, value: PersistedClient): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

const indexedDbStore = createStore(
  "agent-native-action-query-cache",
  "queries",
);
const indexedDbStorage: ActionQueryCacheStorage = {
  get: (key) => getEntry<PersistedClient>(key, indexedDbStore),
  set: (key, value) => setEntry(key, value, indexedDbStore),
  del: (key) => deleteEntry(key, indexedDbStore),
  keys: async () => (await listKeys(indexedDbStore)).map(String),
  clear: () => clearStore(indexedDbStore),
};

let storage: ActionQueryCacheStorage = indexedDbStorage;
let storageClearGeneration = 0;
let storageClearInFlight: Promise<void> | undefined;
let storageClearRequired = false;
let bindAttemptGeneration = 0;
const inFlightStorageWrites = new Set<Promise<void>>();
const inFlightStorageDeletes = new Set<Promise<void>>();
const failedStorageDeleteScopes = new Set<string>();
const CACHE_EPOCH_KEY = "agent-native.action-query-cache.epoch";
const CLEAR_INTENT_PREFIX = "agent-native.action-query-cache.clear-required:";
let cacheSafetyUnavailable = false;

interface ClearIntent {
  key: string;
  value: string | null;
}

interface CacheSafetyState {
  epoch: string;
  pendingClearIntents: ClearIntent[];
}

function newCacheToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readCacheSafetyState(
  probeWrite = false,
): CacheSafetyState | undefined {
  if (cacheSafetyUnavailable || typeof window === "undefined") return undefined;
  try {
    const local = window.localStorage;
    let epoch = local.getItem(CACHE_EPOCH_KEY);
    if (!epoch) {
      epoch = newCacheToken();
      local.setItem(CACHE_EPOCH_KEY, epoch);
      if (local.getItem(CACHE_EPOCH_KEY) !== epoch) {
        cacheSafetyUnavailable = true;
        return undefined;
      }
    } else if (probeWrite) {
      const probeKey = `${CACHE_EPOCH_KEY}.probe:${newCacheToken()}`;
      const probeValue = newCacheToken();
      try {
        local.setItem(probeKey, probeValue);
        if (local.getItem(probeKey) !== probeValue) {
          throw new Error("Unable to verify cache epoch storage access");
        }
      } finally {
        local.removeItem(probeKey);
      }
      if (local.getItem(CACHE_EPOCH_KEY) !== epoch) {
        cacheSafetyUnavailable = true;
        return undefined;
      }
    }
    const pendingClearIntents: ClearIntent[] = [];
    for (let index = 0; index < local.length; index += 1) {
      const key = local.key(index);
      if (key?.startsWith(CLEAR_INTENT_PREFIX)) {
        pendingClearIntents.push({ key, value: local.getItem(key) });
      }
    }
    return { epoch, pendingClearIntents };
  } catch {
    cacheSafetyUnavailable = true;
    return undefined;
  }
}

function beginDurableClearIntent(): ClearIntent | undefined {
  const local = (() => {
    try {
      return typeof window === "undefined" ? undefined : window.localStorage;
    } catch {
      cacheSafetyUnavailable = true;
      return undefined;
    }
  })();
  if (!local || cacheSafetyUnavailable) return undefined;
  const value = newCacheToken();
  const key = `${CLEAR_INTENT_PREFIX}${value}`;
  let intent: ClearIntent | undefined;
  let epochAdvanced = false;
  try {
    local.setItem(key, value);
    if (local.getItem(key) !== value)
      throw new Error("Unable to persist cache clear intent");
    intent = { key, value };
  } catch (error) {
    console.warn(
      "Unable to persist cache clear intent; trying epoch invalidation",
      error,
    );
  }
  try {
    const epoch = newCacheToken();
    local.setItem(CACHE_EPOCH_KEY, epoch);
    if (local.getItem(CACHE_EPOCH_KEY) !== epoch)
      throw new Error("Unable to persist cache epoch");
    epochAdvanced = true;
  } catch (error) {
    console.warn(
      "Unable to persist cache epoch; relying on clear intent",
      error,
    );
  }
  if (intent || epochAdvanced) return intent;
  cacheSafetyUnavailable = true;
  return undefined;
}

function removeCompletedClearIntents(intents: ClearIntent[]): void {
  try {
    if (typeof window === "undefined") return;
    const local = window.localStorage;
    for (const intent of intents) {
      if (
        intent.key.startsWith(CLEAR_INTENT_PREFIX) &&
        local.getItem(intent.key) === intent.value
      ) {
        local.removeItem(intent.key);
      }
    }
  } catch (error) {
    console.warn(
      "Unable to remove completed cache clear intent; later binds will retry",
      error,
    );
  }
}

function clearIntents(): ClearIntent[] {
  return readCacheSafetyState()?.pendingClearIntents ?? [];
}

function matchesCacheEpoch(epoch: string): boolean {
  const current = readCacheSafetyState();
  return (
    current !== undefined &&
    current.epoch === epoch &&
    current.pendingClearIntents.length === 0
  );
}

function trackStorageWrite(write: Promise<void>): void {
  inFlightStorageWrites.add(write);
  void write.then(
    () => inFlightStorageWrites.delete(write),
    () => inFlightStorageWrites.delete(write),
  );
}

function trackStorageDelete(deletion: Promise<void>): Promise<void> {
  inFlightStorageDeletes.add(deletion);
  void deletion.then(
    () => inFlightStorageDeletes.delete(deletion),
    () => inFlightStorageDeletes.delete(deletion),
  );
  return deletion;
}

function beginStorageClear(): Promise<void> {
  if (storageClearInFlight) return storageClearInFlight;
  storageClearRequired = true;
  beginDurableClearIntent();
  const intentsToClear = clearIntents();
  const generation = ++storageClearGeneration;
  let clear!: Promise<void>;
  clear = (async () => {
    await waitForStorageOperations();
    await storage.clear();
    failedStorageDeleteScopes.clear();
    removeCompletedClearIntents(intentsToClear);
    storageClearRequired = clearIntents().length > 0;
  })().finally(() => {
    if (
      storageClearInFlight === clear &&
      storageClearGeneration === generation
    ) {
      storageClearInFlight = undefined;
    }
  });
  storageClearInFlight = clear;
  return clear;
}

async function waitForStorageClear(): Promise<void> {
  while (storageClearInFlight) {
    const clear = storageClearInFlight;
    await clear;
  }
  if (storageClearRequired) {
    await beginStorageClear();
  }
}

async function waitForStorageClearWithinBound(
  timeoutMs = INITIAL_CLEAR_TIMEOUT_MS,
): Promise<boolean> {
  if (timeoutMs <= 0) {
    console.warn(
      "Cached action results could not be cleared within the binding deadline",
    );
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      waitForStorageClear().then(() => true),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function releaseWithoutCache(client: QueryClient, attempt: number): void {
  closeBinding();
  client.removeQueries({ queryKey: ACTION_QUERY_KEY });
  registerActionQueryCacheRevoker(client, () => {
    if (attempt !== bindAttemptGeneration || binding !== undefined) {
      return;
    }
    void clearActionQueryCache().catch((error) =>
      console.warn("Unable to clear cached action results", error),
    );
  });
}

async function waitForStorageOperations(): Promise<void> {
  while (inFlightStorageWrites.size > 0 || inFlightStorageDeletes.size > 0) {
    await Promise.allSettled([
      ...inFlightStorageWrites,
      ...inFlightStorageDeletes,
    ]);
  }
}

/** @internal exported for tests */
export function setActionQueryCacheStorage(
  next: ActionQueryCacheStorage | undefined,
): void {
  storage = next ?? indexedDbStorage;
}

/**
 * The record a session's results live under: one per user, org, and client
 * build. The session comes only from the verified session, never a hint saved
 * from an earlier visit. The build keeps a deploy from painting results shaped
 * by the previous build.
 */
export function actionQueryCacheScope(
  session: Pick<AuthSession, "email" | "userId" | "orgId">,
  buildId: string,
): string {
  return JSON.stringify([
    session.userId ?? session.email,
    session.orgId ?? null,
    buildId,
  ]);
}

// The record's timestamp is re-stamped on every write, so it only bounds the
// last write. Each query's own data age has to be checked here, or results
// written an hour after they were fetched would restore as fresh.
function withinMaxAge(
  stored: PersistedClient | undefined,
): PersistedClient | undefined {
  if (!stored) return undefined;
  const cutoff = Date.now() - ACTION_QUERY_CACHE_MAX_AGE_MS;
  return {
    ...stored,
    clientState: {
      ...stored.clientState,
      queries: stored.clientState.queries.filter(
        (query) => query.state.dataUpdatedAt >= cutoff,
      ),
    },
  };
}

interface RestoredSource {
  dataUpdatedAt: number;
  data: unknown;
  queryKey: readonly unknown[];
  status: string;
}

interface ScopedPersister extends Persister {
  /** Drops a write still waiting on the debounce, then deletes the record. */
  discard(): void;
  /** Blocks restore and writes when cleanup cannot safely complete. */
  blockRestoreAndPersistence(): void;
  close(): void;
  /** The query hashes and data ages the last restore hydrated from the record. */
  restoredStates(): ReadonlyMap<string, number>;
  restoredSources(): ReadonlyMap<string, RestoredSource>;
  restoreWasAccepted(): boolean;
  releaseRestorePayload(): void;
}

// ponytail: one record holds every persisted result for the scope, with no size cap; split per query or cap bytes if restore shows up in traces.
function scopedPersister(scope: string, cacheEpoch: string): ScopedPersister {
  const createdDuringClearGeneration = storageClearGeneration;
  let open = true;
  let persistBlocked = false;
  let latest: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let restored = new Map<string, number>();
  let restoredSources = new Map<string, RestoredSource>();
  let restoreAccepted = false;
  let restoreBlocked = false;
  let restoreRevision = 0;
  const writesInFlight = new Set<Promise<void>>();

  const clearRestoredState = () => {
    restoreAccepted = false;
    restored = new Map();
    restoredSources = new Map();
  };

  const canUseCache = () => {
    const safe = matchesCacheEpoch(cacheEpoch);
    if (!safe) {
      persistBlocked = true;
      restoreBlocked = true;
      clearRestoredState();
      latest = undefined;
      clearTimeout(timer);
      timer = undefined;
    }
    return safe;
  };

  const flush = () => {
    timer = undefined;
    const next = latest;
    latest = undefined;
    if (!open || persistBlocked || !next || !canUseCache()) return;
    const write = storage
      .set(scope, next)
      .catch((error) =>
        console.warn("Unable to save cached action results", error),
      );
    writesInFlight.add(write);
    trackStorageWrite(write);
    void write.then(
      () => writesInFlight.delete(write),
      () => writesInFlight.delete(write),
    );
  };

  return {
    persistClient(client) {
      if (!open || persistBlocked || !canUseCache()) return;
      latest = client;
      timer ??= setTimeout(flush, WRITE_DELAY_MS);
    },
    async restoreClient() {
      clearRestoredState();
      if (!open || restoreBlocked || !canUseCache()) return undefined;
      const revision = restoreRevision;
      const stored = await storage.get(scope);
      // A revoked record can still be in an outstanding storage read. Do not
      // return it to the persister after discard, even if the read was started
      // before the matching access-denied response.
      const record =
        open && !restoreBlocked && revision === restoreRevision && canUseCache()
          ? withinMaxAge(stored)
          : undefined;
      restored = new Map(
        record?.clientState.queries.map((query) => [
          query.queryHash,
          query.state.dataUpdatedAt,
        ]),
      );
      restoredSources = new Map(
        record?.clientState.queries.map((query) => [
          query.queryHash,
          {
            dataUpdatedAt: query.state.dataUpdatedAt,
            data: query.state.data,
            queryKey: query.queryKey,
            status: query.state.status,
          },
        ]),
      );
      restoreAccepted =
        open &&
        !restoreBlocked &&
        revision === restoreRevision &&
        record !== undefined;
      return record;
    },
    restoredStates() {
      return restored;
    },
    restoredSources() {
      return restoredSources;
    },
    restoreWasAccepted() {
      return open && !restoreBlocked && restoreAccepted;
    },
    releaseRestorePayload() {
      restoreAccepted = false;
      restoredSources = new Map();
    },
    removeClient() {
      restoreBlocked = true;
      restoreRevision += 1;
      clearRestoredState();
      if (createdDuringClearGeneration !== storageClearGeneration) {
        return Promise.resolve();
      }
      return trackStorageDelete(storage.del(scope));
    },
    discard() {
      persistBlocked = true;
      restoreBlocked = true;
      restoreRevision += 1;
      clearRestoredState();
      // A debounced write still holds the client as it was before the revoke,
      // and would put the revoked result back after this delete.
      latest = undefined;
      clearTimeout(timer);
      timer = undefined;
      if (createdDuringClearGeneration !== storageClearGeneration) return;
      const currentSafety = readCacheSafetyState();
      if (currentSafety && currentSafety.epoch !== cacheEpoch) return;
      storageClearRequired = true;
      beginDurableClearIntent();
      const deletion = (async () => {
        await Promise.all([...writesInFlight]);
        await storage.del(scope);
      })();
      trackRevokedScopeDelete(scope, deletion);
    },
    blockRestoreAndPersistence() {
      persistBlocked = true;
      restoreBlocked = true;
      restoreRevision += 1;
      clearRestoredState();
      latest = undefined;
      clearTimeout(timer);
      timer = undefined;
    },
    close() {
      open = false;
      restoreBlocked = true;
      restoreRevision += 1;
      clearRestoredState();
      latest = undefined;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

interface Binding {
  client: QueryClient;
  scope: string;
  token: object;
  persister: ScopedPersister;
  unsubscribe: () => void;
}

let binding: Binding | undefined;
let bindingGeneration = 0;
const bindingScopes = new WeakMap<object, string>();

function trackRevokedScopeDelete(
  scope: string,
  deletion: Promise<void>,
): Promise<void> {
  const trackedDeletion = deletion.then(
    () => {
      failedStorageDeleteScopes.delete(scope);
    },
    (error) => {
      failedStorageDeleteScopes.add(scope);
      storageClearRequired = true;
      beginDurableClearIntent();
      throw error;
    },
  );
  trackStorageDelete(trackedDeletion);
  void trackedDeletion.catch((error) =>
    console.warn("Unable to delete cached action results", error),
  );
  return trackedDeletion;
}

/** Stops persisting and drops this document's action results. Storage is
 * untouched. */
function closeBinding(): void {
  bindingGeneration += 1;
  const closing = binding;
  binding = undefined;
  setActionQueryCacheBindingToken(undefined);
  if (!closing) return;
  closing.persister.close();
  closing.unsubscribe();
  // Keep access-denied errors as evidence for the next bind. A cached success
  // for the same key must not be restored after a 401/403/404 was observed.
  for (const query of closing.client
    .getQueryCache()
    .findAll({ queryKey: ACTION_QUERY_KEY })) {
    if (isAccessDeniedActionQuery(query)) {
      clearAccessDeniedActionQueryData(query);
    } else {
      closing.client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

async function waitForCleanup(
  cleanup: Promise<void>,
  timeoutMessage = "Cached action results could not be prepared in time; loading without them.",
  timeoutMs = RESTORE_TIMEOUT_MS,
): Promise<boolean> {
  if (timeoutMs <= 0) {
    void cleanup.catch((error) =>
      console.warn("Cache cleanup failed after its deadline", error),
    );
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      console.warn(timeoutMessage);
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([cleanup.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRestore(
  restored: Promise<void>,
  timeoutMs = RESTORE_TIMEOUT_MS,
): Promise<void> {
  if (timeoutMs <= 0) {
    console.warn(
      "Cached action results did not restore in time; loading without them.",
    );
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        "Cached action results did not restore in time; loading without them.",
      );
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([
      restored.catch((error) =>
        console.warn("Unable to restore cached action results", error),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Points the client's action results at one scope's record and restores it.
 * Resolves once the record is in the client or the restore has given up.
 */
export async function bindActionQueryCache(
  client: QueryClient,
  scope: string,
  options: { trustPrebindResults?: boolean } = {},
): Promise<void> {
  const attempt = ++bindAttemptGeneration;
  const bindDeadline = Date.now() + BIND_WAIT_BUDGET_MS;
  const remainingBindBudget = () => Math.max(0, bindDeadline - Date.now());
  let cacheSafety = readCacheSafetyState(true);
  if (!cacheSafety) {
    releaseWithoutCache(client, attempt);
    return;
  }
  if (!storageClearInFlight) {
    storageClearRequired = cacheSafety.pendingClearIntents.length > 0;
  }
  if (storageClearInFlight || storageClearRequired) {
    let clearFinished: boolean;
    try {
      clearFinished = await waitForStorageClearWithinBound(
        remainingBindBudget(),
      );
    } catch (error) {
      if (attempt === bindAttemptGeneration) {
        releaseWithoutCache(client, attempt);
      }
      throw error;
    }
    if (attempt !== bindAttemptGeneration) {
      return;
    }
    if (!clearFinished || remainingBindBudget() <= 0) {
      releaseWithoutCache(client, attempt);
      return;
    }
  }
  cacheSafety = readCacheSafetyState(true);
  if (!cacheSafety || cacheSafety.pendingClearIntents.length > 0) {
    releaseWithoutCache(client, attempt);
    return;
  }
  const trustPrebindResults = options.trustPrebindResults === true;
  const previousBinding = binding;
  const alreadyBoundClient = previousBinding?.client === client;
  const deniedBeforeBind = client
    .getQueryCache()
    .getAll()
    .filter(isAccessDeniedActionQuery);
  const denialsKnownFromDifferentScope = deniedBeforeBind.filter((query) => {
    const token = getAccessDeniedActionQueryBinding(query);
    const denialScope = token ? bindingScopes.get(token) : undefined;
    return denialScope !== undefined && denialScope !== scope;
  });
  const everyDenialKnownFromDifferentScope =
    deniedBeforeBind.length > 0 &&
    denialsKnownFromDifferentScope.length === deniedBeforeBind.length;
  const earlierDeletes = [...inFlightStorageDeletes];
  closeBinding();
  // An unverified result fetched before the first scope was known must not be
  // consumed by the newly authenticated tree. Trusted first-read preloads stay
  // in memory, but their fetch-start token remains absent, so they are never
  // adopted into this scope's persisted record.
  if (!alreadyBoundClient && !trustPrebindResults) {
    client.removeQueries({
      queryKey: ACTION_QUERY_KEY,
      predicate: (query) => !isAccessDeniedActionQuery(query),
    });
  }
  const generation = bindingGeneration;
  const persister = scopedPersister(scope, cacheSafety.epoch);
  const token = {};
  registerActionQueryCacheRevoker(client, () => persister.discard(), token);
  bindingScopes.set(token, scope);
  let unsubscribePersist = () => {};
  let stopHydrationTracking = () => {};
  let unsubscribeRevoked = () => {};
  const currentBinding: Binding = {
    client,
    scope,
    token,
    persister,
    unsubscribe: () => {
      unsubscribePersist();
      unsubscribeRevoked();
      stopHydrationTracking();
    },
  };
  binding = currentBinding;
  setActionQueryCacheBindingToken(token);
  const isCurrentBinding = () =>
    binding === currentBinding && generation === bindingGeneration;

  unsubscribeRevoked = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    if (event.query.queryKey[0] !== "action") return;
    const status = actionErrorStatus(event.action.error);
    if (status === 401 || status === 403 || status === 404) {
      const deniedBinding = getAccessDeniedActionQueryBinding(event.query);
      const deniedScope = deniedBinding
        ? bindingScopes.get(deniedBinding)
        : undefined;
      if (deniedScope !== undefined && deniedScope !== scope) return;
      revokeBrowserPersistableActionQuery(event.query);
      persister.discard();
      clearAccessDeniedActionQueryData(event.query);
    }
  });

  if (deniedBeforeBind.length > 0) {
    if (!everyDenialKnownFromDifferentScope) persister.discard();
    for (const query of deniedBeforeBind) {
      revokeBrowserPersistableActionQuery(query);
      if (everyDenialKnownFromDifferentScope) {
        query.setState({
          data: undefined,
          dataUpdatedAt: 0,
          error: null,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          status: "pending",
          fetchStatus: "idle",
        });
      } else {
        clearAccessDeniedActionQueryData(query);
      }
    }
  }

  const cleanup = (async () => {
    await Promise.allSettled(earlierDeletes);
    if (!isCurrentBinding()) return;
    let blockPersistenceForScope = false;
    if (failedStorageDeleteScopes.has(scope)) {
      try {
        await trackRevokedScopeDelete(scope, storage.del(scope));
      } catch (error) {
        blockPersistenceForScope = true;
      }
    }
    if (blockPersistenceForScope) persister.blockRestoreAndPersistence();
    if (!isCurrentBinding()) return;
    await waitForStorageOperations();
    if (!isCurrentBinding()) return;
    const keys = await storage.keys();
    if (!isCurrentBinding()) return;
    for (const key of keys) {
      if (key === scope) continue;
      if (!isCurrentBinding()) return;
      await trackRevokedScopeDelete(key, storage.del(key));
    }
  })();
  try {
    if (
      !(await waitForCleanup(cleanup, undefined, remainingBindBudget())) ||
      remainingBindBudget() <= 0
    ) {
      if (isCurrentBinding()) persister.blockRestoreAndPersistence();
      return;
    }
    if (!isCurrentBinding()) return;

    let payloadMappingValid = true;
    let deserializeIndex = 0;
    const deserializedByHash = new Map<
      string,
      { dataUpdatedAt: number; data: unknown }
    >();
    let cachedSourceEntries: Array<[string, RestoredSource]> | undefined;
    const sourceEntries = () => {
      cachedSourceEntries ??= [...persister.restoredSources()].filter(
        ([, source]) => source.data !== undefined,
      );
      return cachedSourceEntries;
    };
    const clientHydrateOptions = client.getDefaultOptions().hydrate;
    const clientDeserializeData = clientHydrateOptions?.deserializeData;
    const hydrateOptions = {
      defaultOptions: {
        ...clientHydrateOptions,
        deserializeData: (data: unknown) => {
          const result = clientDeserializeData
            ? clientDeserializeData(data)
            : data;
          const expected = sourceEntries()[deserializeIndex++];
          if (!expected || !Object.is(expected[1].data, data)) {
            payloadMappingValid = false;
          } else {
            deserializedByHash.set(expected[0], {
              dataUpdatedAt: expected[1].dataUpdatedAt,
              data: result,
            });
          }
          return result;
        },
      },
    };
    const hydratedQueryHashes = new Set<string>();
    stopHydrationTracking = client.getQueryCache().subscribe((event) => {
      if (!persister.restoreWasAccepted()) return;
      const hash = event.query.queryHash;
      const source = persister.restoredSources().get(hash);
      const deserialized = deserializedByHash.get(hash);
      if (!source || !deserialized) return;
      // An unrelated local setState can happen while restore is pending. Count
      // it only when its payload is the object produced by SDK deserialization.
      const isHydratedState = (state: {
        data?: unknown;
        dataUpdatedAt?: number;
        status?: string;
      }) =>
        state.status === source.status &&
        state.dataUpdatedAt === source.dataUpdatedAt &&
        Object.is(state.data, deserialized.data);
      if (event.type === "added" && isHydratedState(event.query.state)) {
        hydratedQueryHashes.add(hash);
      } else if (
        event.type === "updated" &&
        event.action.type === "setState" &&
        isHydratedState(event.action.state)
      ) {
        hydratedQueryHashes.add(hash);
      }
    });
    const [unsubscribe, restored] = persistQueryClient({
      queryClient: client,
      persister,
      buster: `${ACTION_QUERY_CACHE_BUSTER}:${cacheSafety.epoch}`,
      maxAge: ACTION_QUERY_CACHE_MAX_AGE_MS,
      hydrateOptions,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          isBrowserPersistableActionQueryForBinding(query, token),
        // A mutation replayed from disk would look like a write that succeeded.
        shouldDehydrateMutation: () => false,
      },
    });
    unsubscribePersist = unsubscribe;

    const finishAcceptedRestore = () => {
      const expectedDataCount = sourceEntries().length;
      if (deserializeIndex !== expectedDataCount) payloadMappingValid = false;
      if (
        !payloadMappingValid ||
        generation !== bindingGeneration ||
        !persister.restoreWasAccepted()
      ) {
        return;
      }
      const restoredStates = persister.restoredStates();
      const restoredSources = persister.restoredSources();
      for (const query of client.getQueryCache().getAll()) {
        const source = restoredSources.get(query.queryHash);
        const deserialized = deserializedByHash.get(query.queryHash);
        if (
          hydratedQueryHashes.has(query.queryHash) &&
          source?.queryKey[0] === "action" &&
          source.status === "success" &&
          query.queryKey[0] === "action" &&
          query.state.status === "success" &&
          restoredStates.get(query.queryHash) === query.state.dataUpdatedAt &&
          source.dataUpdatedAt === deserialized?.dataUpdatedAt &&
          Object.is(query.state.data, deserialized?.data)
        ) {
          markRestoredBrowserPersistableActionQuery(query, token);
        }
      }
    };
    // This runs after SDK hydration settles even if the UI's bounded wait has
    // already released the app; a later scope generation cannot be authorized.
    void restored
      .then(
        () => {
          finishAcceptedRestore();
        },
        () => {},
      )
      .finally(() => {
        cachedSourceEntries = undefined;
        deserializedByHash.clear();
        hydratedQueryHashes.clear();
        persister.releaseRestorePayload();
        stopHydrationTracking();
        stopHydrationTracking = () => {};
      });
    await waitForRestore(restored, remainingBindBudget());
    // A scope change during the restore can hydrate the old scope after the new
    // one has started; drop those results before the new scope saves them. A
    // query the new scope has refetched since holds newer data and is kept.
    if (generation !== bindingGeneration) {
      const restoredStates = persister.restoredStates();
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === "action" &&
          restoredStates.get(query.queryHash) === query.state.dataUpdatedAt,
      });
    }
  } catch (error) {
    if (binding === currentBinding) closeBinding();
    throw error;
  }
}

/** Sign-out: stop, drop this document's results, and delete every stored
 * record. */
export async function clearActionQueryCache(): Promise<void> {
  closeBinding();
  const clear = beginStorageClear();
  const clearFinished = await waitForCleanup(
    clear,
    "Cached action results could not be cleared in time; cleanup remains required.",
  );
  if (!clearFinished) {
    throw new Error(
      "Cached action result clearing timed out; cleanup remains required.",
    );
  }
}

/**
 * Holds action queries until the session's cached results are in the client,
 * so a revisit paints them instead of a skeleton. With a signed-out session it
 * clears the stored results, whichever path ended that session.
 */
export function ActionQueryCacheGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { session, status } = useSession();
  const scope = session
    ? actionQueryCacheScope(session, clientBuildId())
    : null;
  const terminalUnauthenticated = status === "unauthenticated";
  const bindAttempt = useMemo(
    () => ({
      trustPrebindResults:
        scope !== null && !terminalUnauthenticated && isSessionFromFirstRead(),
    }),
    [queryClient, scope, terminalUnauthenticated],
  );
  const [settledAttempt, setSettledAttempt] = useState<object | null>(null);

  useEffect(() => {
    // A transient session reread does not replace a same-scope cache binding.
    if (terminalUnauthenticated) {
      clearActionQueryCache().catch((error) =>
        console.warn("Unable to clear cached action results", error),
      );
      setSettledAttempt(bindAttempt);
      return;
    }
    if (!scope) {
      setSettledAttempt(bindAttempt);
      return;
    }
    let current = true;
    const finish = () => {
      if (current) setSettledAttempt(bindAttempt);
    };
    bindActionQueryCache(queryClient, scope, {
      trustPrebindResults: bindAttempt.trustPrebindResults,
    }).then(finish, (error) => {
      console.warn("Unable to use cached action results", error);
      finish();
    });
    return () => {
      current = false;
      bindAttemptGeneration += 1;
      closeBinding();
    };
  }, [bindAttempt, queryClient, scope, terminalUnauthenticated]);

  const restoring = scope !== null && settledAttempt !== bindAttempt;
  const holdUntrustedChildren =
    scope !== null && !bindAttempt.trustPrebindResults && restoring;
  return (
    <IsRestoringProvider value={restoring}>
      {holdUntrustedChildren ? null : children}
    </IsRestoringProvider>
  );
}
