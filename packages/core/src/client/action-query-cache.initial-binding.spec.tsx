import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

vi.mock("./use-session.js", () => ({
  useSession: () => ({ session: null, status: "unavailable", isLoading: true }),
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import {
  actionQueryCacheScope,
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
import {
  isBrowserPersistableActionQuery,
  useActionQuery,
} from "./use-action.js";

const USER_A = {
  email: "a@example.test",
  userId: "prebind-user-a",
  orgId: "org-a",
};
const USER_B = {
  email: "b@example.test",
  userId: "prebind-user-b",
  orgId: "org-b",
};
const SCOPE_A = actionQueryCacheScope(USER_A, "initial-binding-tests");
const SCOPE_B = actionQueryCacheScope(USER_B, "initial-binding-tests");
const ACTION_KEY = ["action", "list-designs", undefined] as const;

type Payload = { designs: Array<{ title: string }> };
type Snapshot = { data: Payload | undefined; status: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function response(status: number, payload: unknown, allow = false): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(allow ? { "X-Agent-Native-Browser-Persist": "allow" } : {}),
    },
  });
}

function cacheRecord(
  queryKey: readonly unknown[],
  data: unknown,
): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, data, { updatedAt: Date.now() - 50 });
  return {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
}

function App({ onSnapshot }: { onSnapshot: (snapshot: Snapshot) => void }) {
  const query = useActionQuery<Payload>("list-designs" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  onSnapshot({ data: query.data, status: query.status });
  return null;
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];
async function mount(
  client: QueryClient,
  onSnapshot: (snapshot: Snapshot) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <App onSnapshot={onSnapshot} />
      </QueryClientProvider>,
    );
  });
}

async function cleanup() {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
    entry.client.clear();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

afterEach(cleanup);

it("stops an older key lookup before it can start a newer scope bind", async () => {
  const keysA = deferred<string[]>();
  const keysStarted = deferred<void>();
  let keyCalls = 0;
  const storage: ActionQueryCacheStorage = {
    get: async () => undefined,
    set: async () => {},
    del: async () => {},
    keys: () => {
      keyCalls += 1;
      if (keyCalls === 1) {
        keysStarted.resolve();
        return keysA.promise;
      }
      return Promise.resolve([]);
    },
    clear: async () => {},
  };
  setActionQueryCacheStorage(storage);
  const client = new QueryClient();
  client.setQueryData(ACTION_KEY, { designs: [{ title: "pre-bind A" }] });

  const bindingA = bindActionQueryCache(client, SCOPE_A);
  await keysStarted.promise;
  const bindingB = bindActionQueryCache(client, SCOPE_B);
  keysA.resolve([]);
  await Promise.all([bindingA, bindingB]);

  expect(keyCalls).toBe(2);
  expect(client.getQueryCache().find({ queryKey: ACTION_KEY })).toBeUndefined();
});

it("waits for in-flight cleanup before restoring the new scope", async () => {
  const savedBKey = ["action", "list-designs", "saved-b"] as const;
  const savedB = cacheRecord(savedBKey, { designs: [{ title: "saved B" }] });
  const savedBHash = savedB.clientState.queries[0]?.queryHash;
  const records = new Map([[SCOPE_B, savedB]]);
  const deleteStarted = deferred<void>();
  const finishDelete = deferred<void>();
  const restoreBStarted = deferred<void>();
  let keyCalls = 0;
  let restoreBCalls = 0;
  let heldDelete = false;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      if (key === SCOPE_B) {
        restoreBCalls += 1;
        restoreBStarted.resolve();
      }
      return records.get(key);
    },
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
      if (key === SCOPE_B && !heldDelete) {
        heldDelete = true;
        deleteStarted.resolve();
        await finishDelete.promise;
      }
    },
    keys: async () => {
      keyCalls += 1;
      return [...records.keys()];
    },
    clear: async () => {
      records.clear();
    },
  };
  setActionQueryCacheStorage(storage);

  const clientA = new QueryClient();
  const bindingA = bindActionQueryCache(clientA, SCOPE_A);
  await deleteStarted.promise;
  const clientB = new QueryClient();
  const bindingB = bindActionQueryCache(clientB, SCOPE_B);
  expect(keyCalls).toBe(1);
  expect(restoreBCalls).toBe(0);
  finishDelete.resolve();

  await Promise.all([bindingA, bindingB]);
  await restoreBStarted.promise;
  const restoredB = clientB.getQueryCache().find({ queryKey: savedBKey });
  expect(restoredB?.state.data).toBeUndefined();
  expect(
    records
      .get(SCOPE_B)
      ?.clientState.queries.some((entry) => entry.queryHash === savedBHash) ??
      false,
  ).toBe(false);
  expect(keyCalls).toBe(2);
  clientA.clear();
  clientB.clear();
});

it("does not write an authorized pre-bind user A query into user B's cache", async () => {
  const keyReadA = deferred<string[]>();
  const firstKeysStarted = deferred<void>();
  const records = new Map<string, PersistedClient>();
  let keyCalls = 0;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: () => {
      keyCalls += 1;
      if (keyCalls === 1) {
        firstKeysStarted.resolve();
        return keyReadA.promise;
      }
      return Promise.resolve([]);
    },
    clear: async () => {
      records.clear();
    },
  };
  setActionQueryCacheStorage(storage);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(200, { designs: [{ title: "user A" }] }, true)),
  );
  const client = new QueryClient();
  let snapshot: Snapshot = { data: undefined, status: "pending" };
  await mount(client, (next) => {
    snapshot = next;
  });
  await expect.poll(() => snapshot.data?.designs[0]?.title).toBe("user A");

  const query = client.getQueryCache().find({ queryKey: ACTION_KEY });
  expect(query).toBeDefined();
  expect(isBrowserPersistableActionQuery(query!)).toBe(true);

  const bindingA = bindActionQueryCache(client, SCOPE_A);
  await firstKeysStarted.promise;
  const bindingB = bindActionQueryCache(client, SCOPE_B);
  try {
    keyReadA.resolve([]);
    await Promise.all([bindingA, bindingB]);
    const queryHash = query!.queryHash;
    client.setQueryData(["action", "cache-write-trigger"], { written: true });
    await expect.poll(() => records.has(SCOPE_B)).toBe(true);
    const userBQueries = records.get(SCOPE_B)!.clientState.queries;
    expect
      .soft(userBQueries.some((entry) => entry.queryHash === queryHash))
      .toBe(false);
  } finally {
    keyReadA.resolve([]);
    await Promise.all([bindingA, bindingB]);
  }
});

it.each([401, 403, 404])(
  "does not hydrate a record denied with %s before key lookup finishes",
  async (status) => {
    const keysRead = deferred<string[]>();
    const keysStarted = deferred<void>();
    const fetchRead = deferred<Response>();
    const deleteFinished = deferred<void>();
    const stored = cacheRecord(ACTION_KEY, {
      designs: [{ title: "stale user A" }],
    });
    const records = new Map([[SCOPE_A, stored]]);
    let getCalls = 0;
    const storage: ActionQueryCacheStorage = {
      get: async (key) => {
        getCalls += 1;
        return records.get(key);
      },
      set: async (key, value) => {
        records.set(key, value);
      },
      del: async (key) => {
        await deleteFinished.promise;
        records.delete(key);
      },
      keys: () => {
        keysStarted.resolve();
        return keysRead.promise;
      },
      clear: async () => {
        records.clear();
      },
    };
    setActionQueryCacheStorage(storage);
    const fetchStarted = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchStarted.resolve();
        return fetchRead.promise;
      }),
    );
    const client = new QueryClient();
    let snapshot: Snapshot = { data: undefined, status: "pending" };
    await mount(client, (next) => {
      snapshot = next;
    });
    await fetchStarted.promise;

    const binding = bindActionQueryCache(client, SCOPE_A, {
      trustPrebindResults: true,
    });
    await keysStarted.promise;
    const deniedQuery = client.getQueryCache().find({ queryKey: ACTION_KEY });
    try {
      fetchRead.resolve(response(status, { error: "access denied" }));
      await expect.poll(() => snapshot.status).toBe("error");
      expect(deniedQuery?.state.status).toBe("error");
      expect(getCalls).toBe(0);

      keysRead.resolve([SCOPE_A]);
      await binding;
      expect.soft(deniedQuery?.state.status).toBe("error");
      expect.soft(deniedQuery?.state.data).toBeUndefined();
      expect.soft(isBrowserPersistableActionQuery(deniedQuery!)).toBe(false);
      expect(records.has(SCOPE_A)).toBe(true);
      deleteFinished.resolve();
      await expect.poll(() => records.has(SCOPE_A)).toBe(false);
    } finally {
      deleteFinished.resolve();
      keysRead.resolve([SCOPE_A]);
      fetchRead.resolve(response(403, { error: "forbidden" }));
      await binding;
    }
  },
);

it("lets the latest scope bind finish while a superseded key lookup is pending", async () => {
  const oldKeys = deferred<string[]>();
  const oldKeysStarted = deferred<void>();
  let oldKeysResolved = false;
  const oldKeysRead = oldKeys.promise.then((keys) => {
    oldKeysResolved = true;
    return keys;
  });
  let keyCalls = 0;
  const storage: ActionQueryCacheStorage = {
    get: async () => undefined,
    set: async () => {},
    del: async () => {},
    keys: () => {
      keyCalls += 1;
      if (keyCalls === 1) {
        oldKeysStarted.resolve();
        return oldKeysRead;
      }
      return Promise.resolve([]);
    },
    clear: async () => {},
  };
  setActionQueryCacheStorage(storage);

  const bindingA = bindActionQueryCache(new QueryClient(), SCOPE_A);
  await oldKeysStarted.promise;
  const bindingB = bindActionQueryCache(new QueryClient(), SCOPE_B);
  let bindingBFinished = false;
  void bindingB.then(() => {
    bindingBFinished = true;
  });

  try {
    await expect.poll(() => keyCalls).toBe(2);
    await expect.poll(() => bindingBFinished).toBe(true);
    expect(oldKeysResolved).toBe(false);
  } finally {
    oldKeys.resolve([]);
    await Promise.all([bindingA, bindingB]);
  }
});
