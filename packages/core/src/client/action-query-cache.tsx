import {
  persistQueryClient,
  type Persister,
  type PersistedClient,
} from "@tanstack/query-persist-client-core";
import {
  IsRestoringProvider,
  useQueryClient,
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
import { useEffect, useState, type ReactNode } from "react";

import type { AuthSession } from "../server/auth.js";
import { clientBuildId } from "./build-compatibility.js";
import { isBrowserPersistableActionQuery } from "./use-action.js";
import { useSession } from "./use-session.js";

// Bump when a cached result's shape or meaning changes. A record stored under
// another buster is discarded on restore instead of being hydrated.
const ACTION_QUERY_CACHE_BUSTER = "action-query-cache-v1";
const ACTION_QUERY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// Every cache event dehydrates the whole client, so writes are coalesced to one
// per window instead of one per fetch state change.
const WRITE_DELAY_MS = 1_000;
// Restoring holds every query, so a store that never answers must not hold
// the app.
const RESTORE_TIMEOUT_MS = 2_000;
const ACTION_QUERY_KEY = ["action"];

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

interface ScopedPersister extends Persister {
  close(): void;
}

// ponytail: one record holds every persisted result for the scope, with no size cap; split per query or cap bytes if restore shows up in traces.
function scopedPersister(scope: string): ScopedPersister {
  let open = true;
  let latest: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    const next = latest;
    latest = undefined;
    if (!open || !next) return;
    storage
      .set(scope, next)
      .catch((error) =>
        console.warn("Unable to save cached action results", error),
      );
  };

  return {
    persistClient(client) {
      if (!open) return;
      latest = client;
      timer ??= setTimeout(flush, WRITE_DELAY_MS);
    },
    async restoreClient() {
      if (!open) return undefined;
      const stored = await storage.get(scope);
      // Closed while the read was in flight: the record belongs to a scope the
      // page has left, so it must not be hydrated into this client.
      return open ? stored : undefined;
    },
    removeClient() {
      return storage.del(scope);
    },
    close() {
      open = false;
      latest = undefined;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

interface Binding {
  client: QueryClient;
  persister: ScopedPersister;
  unsubscribe: () => void;
}

let binding: Binding | undefined;
let bindingGeneration = 0;

/** Stops persisting and drops this document's action results. Storage is
 * untouched. */
function closeBinding(): void {
  bindingGeneration += 1;
  if (!binding) return;
  binding.persister.close();
  binding.unsubscribe();
  binding.client.removeQueries({ queryKey: ACTION_QUERY_KEY });
  binding = undefined;
}

async function waitForRestore(restored: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        "Cached action results did not restore in time; loading without them.",
      );
      resolve();
    }, RESTORE_TIMEOUT_MS);
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
): Promise<void> {
  closeBinding();
  client.removeQueries({ queryKey: ACTION_QUERY_KEY });
  const generation = bindingGeneration;

  // One record at a time: a record for any other scope belongs to another user
  // or org.
  for (const key of await storage.keys()) {
    if (key !== scope) await storage.del(key);
  }
  if (generation !== bindingGeneration) return;

  const persister = scopedPersister(scope);
  const [unsubscribe, restored] = persistQueryClient({
    queryClient: client,
    persister,
    buster: ACTION_QUERY_CACHE_BUSTER,
    maxAge: ACTION_QUERY_CACHE_MAX_AGE_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: isBrowserPersistableActionQuery,
      // A mutation replayed from disk would look like a write that succeeded.
      shouldDehydrateMutation: () => false,
    },
  });
  binding = { client, persister, unsubscribe };

  await waitForRestore(restored);
  // A scope change during the restore can hydrate the old scope after the new
  // one has started; drop those results before the new scope saves them.
  if (generation !== bindingGeneration) {
    client.removeQueries({ queryKey: ACTION_QUERY_KEY });
  }
}

/** Sign-out: stop, drop this document's results, and delete every stored
 * record. */
export async function clearActionQueryCache(): Promise<void> {
  closeBinding();
  await storage.clear();
}

/**
 * Holds action queries until the session's cached results are in the client,
 * so a revisit paints them instead of a skeleton. Mount it where the session is
 * already known (inside RequireSession); without a session it does nothing.
 */
export function ActionQueryCacheGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const scope = session
    ? actionQueryCacheScope(session, clientBuildId())
    : null;
  const [restoredScope, setRestoredScope] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) return;
    let current = true;
    setRestoredScope(null);
    const finish = () => {
      if (current) setRestoredScope(scope);
    };
    bindActionQueryCache(queryClient, scope).then(finish, (error) => {
      console.warn("Unable to use cached action results", error);
      finish();
    });
    return () => {
      current = false;
      closeBinding();
    };
  }, [queryClient, scope]);

  const restoring = scope !== null && restoredScope !== scope;
  return (
    <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
  );
}
