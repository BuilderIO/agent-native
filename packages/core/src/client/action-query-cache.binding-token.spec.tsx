import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  dehydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React, { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

const sessionState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let session: { email: string; userId: string; orgId: string } | null = null;
  return {
    read: () => session,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(sessionValue: { email: string; userId: string; orgId: string } | null) {
      session = sessionValue;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("./use-session.js", async () => {
  const react = await import("react");
  return {
    isSessionFromFirstRead: () => true,
    useSession: () => {
      const session = react.useSyncExternalStore(
        sessionState.subscribe,
        sessionState.read,
        () => null,
      );
      return {
        session,
        status: session ? "authenticated" : "loading",
        isLoading: !session,
        error: null,
        retry: () => {},
      };
    },
    recheckSessionAfterUnauthorized: vi.fn(),
  };
});
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import {
  ActionQueryCacheGate,
  actionQueryCacheScope,
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
import { clientBuildId } from "./build-compatibility.js";
import {
  isBrowserPersistableActionQuery,
  useActionQuery,
} from "./use-action.js";

const USER_A = {
  email: "a@example.test",
  userId: "binding-user-a",
  orgId: "org-a",
};
const USER_B = {
  email: "b@example.test",
  userId: "binding-user-b",
  orgId: "org-b",
};
const SCOPE_A = actionQueryCacheScope(USER_A, clientBuildId());
const SCOPE_B = actionQueryCacheScope(USER_B, clientBuildId());
const QUERY_KEY = ["action", "list-designs", undefined] as const;
type Payload = { owner: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function response(owner: string): Response {
  return new Response(JSON.stringify({ owner }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-Browser-Persist": "allow",
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

function memoryStorage(seed: Array<[string, PersistedClient]> = []) {
  const records = new Map(seed);
  const reads: string[] = [];
  const writes: Array<{ scope: string; owners: string[] }> = [];
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      reads.push(key);
      return records.get(key);
    },
    set: async (key, value) => {
      writes.push({
        scope: key,
        owners: value.clientState.queries.flatMap((query) => {
          const data = query.state.data;
          return data && typeof data === "object" && "owner" in data
            ? [String(data.owner)]
            : [];
        }),
      });
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  return { records, reads, writes, storage };
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];
async function mount(client: QueryClient, query = true, useCacheGate = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  function Probe() {
    if (query) {
      useActionQuery<Payload>("list-designs" as never, undefined, {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      });
    }
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {useCacheGate ? (
          <ActionQueryCacheGate>
            <Probe />
          </ActionQueryCacheGate>
        ) : (
          <Probe />
        )}
      </QueryClientProvider>,
    );
  });
}

async function settle(ms = 25) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

function queryIn(records: Map<string, PersistedClient>, scope: string) {
  return records
    .get(scope)
    ?.clientState.queries.find(
      (query) => JSON.stringify(query.queryKey) === JSON.stringify(QUERY_KEY),
    );
}

afterEach(async () => {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
    entry.client.clear();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  sessionState.set(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps a completed unknown pre-bind result in memory but excludes it from the first B record", async () => {
  sessionState.set(null);
  const { records, reads, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const fetchMock = vi.fn(async () => response("request-user-a"));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  await mount(client);
  await expect
    .poll(() => client.getQueryData<Payload>(QUERY_KEY)?.owner)
    .toBe("request-user-a");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async () => sessionState.set(USER_B));
  await expect.poll(() => reads.includes(SCOPE_B)).toBe(true);
  await settle();
  expect(client.getQueryData<Payload>(QUERY_KEY)?.owner).toBe("request-user-a");

  client.setQueryData(["action", "binding-trigger"], { ready: true });
  await expect.poll(() => records.has(SCOPE_B), { timeout: 2_000 }).toBe(true);
  expect(queryIn(records, SCOPE_B)).toBeUndefined();
});

it("does not authorize an unknown pre-bind request that resolves after B binds", async () => {
  sessionState.set(null);
  const { records, reads, writes, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const requestStarted = deferred<void>();
  const requestResponse = deferred<Response>();
  let fetchCalls = 0;
  const fetchMock = vi.fn(() => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      requestStarted.resolve();
      return requestResponse.promise;
    }
    return Promise.resolve(response("request-user-b"));
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observedOwners: string[] = [];
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      event.query.queryKey[0] === "action"
    ) {
      const data = event.query.state.data;
      if (data && typeof data === "object" && "owner" in data) {
        observedOwners.push(String(data.owner));
      }
    }
  });

  await mount(client, true, false);
  await requestStarted.promise;
  await bindActionQueryCache(client, SCOPE_B, { trustPrebindResults: true });
  await expect.poll(() => reads.includes(SCOPE_B)).toBe(true);

  requestResponse.resolve(response("request-user-a"));
  await expect.poll(() => observedOwners.includes("request-user-a")).toBe(true);
  client.setQueryData(["action", "binding-trigger"], { ready: true });
  await expect.poll(() => records.has(SCOPE_B), { timeout: 2_000 }).toBe(true);
  await expect
    .poll(() => writes.some((write) => write.scope === SCOPE_B))
    .toBe(true);
  expect(
    writes.some(
      (write) =>
        write.scope === SCOPE_B && write.owners.includes("request-user-a"),
    ),
  ).toBe(false);
  expect(queryIn(records, SCOPE_B)?.state.data).not.toEqual({
    owner: "request-user-a",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it("persists an authorized result fetched after the matching B binding", async () => {
  sessionState.set(USER_B);
  const { records, reads, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const fetchMock = vi.fn(async () => response("request-user-b"));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  await mount(client);
  await expect.poll(() => reads.includes(SCOPE_B)).toBe(true);
  await expect
    .poll(() => client.getQueryData<Payload>(QUERY_KEY)?.owner)
    .toBe("request-user-b");
  await expect
    .poll(() => queryIn(records, SCOPE_B)?.state.data, { timeout: 2_000 })
    .toEqual({ owner: "request-user-b" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not carry an in-flight A grant into B after a scope switch", async () => {
  const { records, writes, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const requestStarted = deferred<void>();
  const requestResponse = deferred<Response>();
  const fetchMock = vi.fn(() => {
    requestStarted.resolve();
    return requestResponse.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const bindingClient = new QueryClient();

  await bindActionQueryCache(bindingClient, SCOPE_A);
  await mount(client, true, false);
  await requestStarted.promise;
  await bindActionQueryCache(bindingClient, SCOPE_B);

  requestResponse.resolve(response("request-user-a"));
  await expect
    .poll(() => client.getQueryData<Payload>(QUERY_KEY)?.owner)
    .toBe("request-user-a");
  const query = client
    .getQueryCache()
    .find({ queryKey: QUERY_KEY, exact: true });
  expect(query).toBeDefined();
  expect(isBrowserPersistableActionQuery(query!)).toBe(true);

  await bindActionQueryCache(client, SCOPE_B);
  client.setQueryData(["action", "binding-trigger"], { ready: true });
  await expect.poll(() => records.has(SCOPE_B), { timeout: 2_000 }).toBe(true);
  await expect
    .poll(() => writes.some((write) => write.scope === SCOPE_B))
    .toBe(true);
  expect(
    writes.some(
      (write) =>
        write.scope === SCOPE_B && write.owners.includes("request-user-a"),
    ),
  ).toBe(false);
  expect(queryIn(records, SCOPE_B)).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("marks an accepted cold restore for the active binding", async () => {
  sessionState.set(USER_B);
  const seeded = cacheRecord(QUERY_KEY, { owner: "saved-user-b" });
  const { records, reads, storage } = memoryStorage([[SCOPE_B, seeded]]);
  setActionQueryCacheStorage(storage);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  await mount(client, false);
  await expect.poll(() => reads.includes(SCOPE_B)).toBe(true);
  await expect
    .poll(() => client.getQueryData<Payload>(QUERY_KEY)?.owner)
    .toBe("saved-user-b");
  const restored = client
    .getQueryCache()
    .find({ queryKey: QUERY_KEY, exact: true });
  expect(restored).toBeDefined();
  expect(isBrowserPersistableActionQuery(restored!)).toBe(true);

  client.setQueryData(["action", "binding-trigger"], { ready: true });
  await expect
    .poll(() => queryIn(records, SCOPE_B)?.state.data, { timeout: 2_000 })
    .toEqual({ owner: "saved-user-b" });
});
