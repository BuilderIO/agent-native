import "./action-query-cache.test-fixtures.js";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let session: { email: string; userId: string; orgId: string } | null = null;
  let fromFirstRead = false;
  return {
    read: () => session,
    isFromFirstRead: () => fromFirstRead,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(
      sessionValue: { email: string; userId: string; orgId: string } | null,
      trustedFirstRead: boolean,
    ) {
      session = sessionValue;
      fromFirstRead = trustedFirstRead;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("./use-session.js", async () => {
  const react = await import("react");
  return {
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
    isSessionFromFirstRead: () => sessionState.isFromFirstRead(),
    recheckSessionAfterUnauthorized: vi.fn(),
  };
});
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import type { PersistedClient } from "@tanstack/query-persist-client-core";

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
  userId: "first-bind-user-a",
  orgId: "org-a",
};
const USER_B = {
  email: "b@example.test",
  userId: "first-bind-user-b",
  orgId: "org-b",
};
const SCOPE_A = actionQueryCacheScope(USER_A, clientBuildId());
const SCOPE_B = actionQueryCacheScope(USER_B, clientBuildId());
const QUERY_KEY = ["action", "list-designs", undefined] as const;
type Payload = { owner: string };

function response(owner: string): Response {
  return new Response(JSON.stringify({ owner }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-Browser-Persist": "allow",
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function memoryStorage() {
  const records = new Map<string, PersistedClient>();
  const reads: string[] = [];
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      reads.push(key);
      return records.get(key);
    },
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  return { records, reads, storage };
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

function OwnerProbe({ renders }: { renders: string[] }) {
  const query = useActionQuery<Payload>("list-designs" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  renders.push(query.data?.owner ?? "<empty>");
  return query.data ? (
    <span data-testid="owner">{query.data.owner}</span>
  ) : null;
}

async function mount(client: QueryClient, renders: string[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });

  function SessionShell({ children }: { children: ReactNode }) {
    const hidden = sessionState.read() === null;
    return (
      <div
        data-testid="session-shell"
        style={{ display: hidden ? "none" : "contents" }}
      >
        {children}
      </div>
    );
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ActionQueryCacheGate>
          <SessionShell>
            <OwnerProbe renders={renders} />
          </SessionShell>
        </ActionQueryCacheGate>
      </QueryClientProvider>,
    );
  });
  return container;
}

function ownerText(container: HTMLDivElement): string | null {
  return container.querySelector('[data-testid="owner"]')?.textContent ?? null;
}

function queryIn(record: PersistedClient | undefined) {
  return record?.clientState.queries.find(
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
  sessionState.set(null, false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps a trusted first-read preload visible without refetching or adopting it into disk cache", async () => {
  sessionState.set(null, false);
  const { records, reads, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const fetchMock = vi.fn(async () => response("first-read-user-a"));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renders: string[] = [];
  const container = await mount(client, renders);

  await expect.poll(() => ownerText(container)).toBe("first-read-user-a");
  const preloaded = client.getQueryCache().find({ queryKey: QUERY_KEY });
  expect(preloaded).toBeDefined();
  expect(isBrowserPersistableActionQuery(preloaded!)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const trustedRenderStart = renders.length;
  await act(async () => sessionState.set(USER_A, true));
  await expect.poll(() => reads.includes(SCOPE_A)).toBe(true);
  await expect.poll(() => ownerText(container)).toBe("first-read-user-a");
  expect(renders.slice(trustedRenderStart)).toContain("first-read-user-a");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  client.setQueryData(["action", "cache-write-trigger"], { ready: true });
  await expect.poll(() => records.has(SCOPE_A), { timeout: 2_000 }).toBe(true);
  expect(queryIn(records.get(SCOPE_A))).toBeUndefined();
});

it("hides and removes a completed unknown preload before first B children remount", async () => {
  sessionState.set(null, false);
  const { storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const keysStarted = deferred<void>();
  const finishKeys = deferred<void>();
  const controlledStorage: ActionQueryCacheStorage = {
    ...storage,
    keys: async () => {
      keysStarted.resolve();
      await finishKeys.promise;
      return [];
    },
  };
  setActionQueryCacheStorage(controlledStorage);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response("unknown-user-a"))
    .mockResolvedValue(response("verified-user-b"));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renders: string[] = [];
  const container = await mount(client, renders);

  await expect.poll(() => ownerText(container)).toBe("unknown-user-a");
  const beforeB = renders.length;
  await act(async () => sessionState.set(USER_B, false));
  await keysStarted.promise;

  expect(ownerText(container)).toBeNull();
  expect(client.getQueryData(QUERY_KEY)).toBeUndefined();
  expect(renders.slice(beforeB)).not.toContain("unknown-user-a");

  finishKeys.resolve();
  await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
  await expect.poll(() => ownerText(container)).toBe("verified-user-b");
  expect(renders.slice(beforeB)).not.toContain("unknown-user-a");
});

it("ignores a prebind response that completes after unverified binding scrub", async () => {
  sessionState.set(null, false);
  const { storage } = memoryStorage();
  const keysStarted = deferred<void>();
  const finishKeys = deferred<void>();
  setActionQueryCacheStorage({
    ...storage,
    keys: async () => {
      keysStarted.resolve();
      await finishKeys.promise;
      return [];
    },
  });
  const firstResponse = deferred<Response>();
  const firstFetchStarted = deferred<void>();
  const fetchMock = vi.fn(() => {
    if (fetchMock.mock.calls.length === 1) {
      firstFetchStarted.resolve();
      return firstResponse.promise;
    }
    return Promise.resolve(response("verified-user-b"));
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renders: string[] = [];
  const container = await mount(client, renders);

  await firstFetchStarted.promise;
  const beforeB = renders.length;
  await act(async () => sessionState.set(USER_B, false));
  await keysStarted.promise;
  expect(ownerText(container)).toBeNull();
  expect(client.getQueryData(QUERY_KEY)).toBeUndefined();

  finishKeys.resolve();
  await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
  await expect.poll(() => ownerText(container)).toBe("verified-user-b");

  firstResponse.resolve(response("late-user-a"));
  await act(async () => Promise.resolve());
  expect(ownerText(container)).toBe("verified-user-b");
  expect(client.getQueryData<Payload>(QUERY_KEY)?.owner).toBe(
    "verified-user-b",
  );
  expect(renders.slice(beforeB)).not.toContain("late-user-a");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("defaults a direct manual bind to clearing unbound action data", async () => {
  setActionQueryCacheStorage(memoryStorage().storage);
  const client = new QueryClient();
  client.setQueryData(QUERY_KEY, { owner: "unverified" });

  await bindActionQueryCache(client, SCOPE_B);

  expect(client.getQueryData(QUERY_KEY)).toBeUndefined();
  expect(client.getQueryCache().find({ queryKey: QUERY_KEY })).toBeUndefined();
  client.clear();
});
