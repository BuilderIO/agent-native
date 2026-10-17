import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import React, { act } from "react";
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
    set(value: { email: string; userId: string; orgId: string } | null) {
      session = value;
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
      };
    },
    isSessionFromFirstRead: () => false,
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
import { useActionQuery } from "./use-action.js";

const USER_A = { email: "a@example.test", userId: "cleanup-a", orgId: "org-a" };
const USER_B = { email: "b@example.test", userId: "cleanup-b", orgId: "org-b" };
const SCOPE_A = actionQueryCacheScope(USER_A, clientBuildId());
const SCOPE_B = actionQueryCacheScope(USER_B, clientBuildId());
const QUERY_KEY = ["action", "list-designs", undefined] as const;

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

function persistedOwner(owner: string): PersistedClient {
  const client = new QueryClient();
  client.setQueryData(QUERY_KEY, { owner }, { updatedAt: Date.now() - 10 });
  const value: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(client),
  };
  client.clear();
  return value;
}

function OwnerProbe() {
  const query = useActionQuery<{ owner: string }>(
    "list-designs" as never,
    undefined,
    {
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
  return <span data-testid="owner">{query.data?.owner ?? "loading"}</span>;
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
let releasePendingWrite: (() => void) | undefined;
async function mount(client: QueryClient, gated: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {gated ? (
          <ActionQueryCacheGate>
            <OwnerProbe />
          </ActionQueryCacheGate>
        ) : (
          <OwnerProbe />
        )}
      </QueryClientProvider>,
    ),
  );
  return container;
}

async function waitForText(container: HTMLDivElement, text: string) {
  await expect
    .poll(() => container.querySelector("[data-testid=owner]")?.textContent, {
      timeout: 3_500,
    })
    .toBe(text);
}

afterEach(async () => {
  releasePendingWrite?.();
  releasePendingWrite = undefined;
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  sessionState.set(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("releases the real Gate on a stalled key scan and stops its late cleanup at the next scope", async () => {
  sessionState.set(USER_A);
  const heldKeys = deferred<string[]>();
  const firstKeysStarted = deferred<void>();
  const firstKeysFinished = deferred<void>();
  const records = new Map<string, PersistedClient>([
    [SCOPE_A, persistedOwner("stale A")],
    [SCOPE_B, persistedOwner("cached B")],
  ]);
  const getCalls: string[] = [];
  const deleteCalls: string[] = [];
  const setCalls: string[] = [];
  let keyCalls = 0;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      getCalls.push(key);
      return records.get(key);
    },
    set: async (key, value) => {
      setCalls.push(key);
      records.set(key, value);
    },
    del: async (key) => {
      deleteCalls.push(key);
      records.delete(key);
    },
    keys: async () => {
      keyCalls += 1;
      if (keyCalls === 1) {
        firstKeysStarted.resolve();
        const keys = await heldKeys.promise;
        firstKeysFinished.resolve();
        return keys;
      }
      return [...records.keys()];
    },
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);
  const fetchMock = vi.fn(async () => response("fresh A"));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = await mount(client, true);
  await firstKeysStarted.promise;

  // Cleanup has not completed, so the bounded restore path must not begin.
  await waitForText(container, "fresh A");
  expect(getCalls).toEqual([]);
  expect(deleteCalls).toEqual([]);
  expect(records.has(SCOPE_A)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(setCalls).toEqual([]);

  // A later verified scope binds normally. The first cleanup is allowed to
  // finish, but its stale generation must not delete B's live record.
  await act(async () => sessionState.set(USER_B));
  await waitForText(container, "cached B");
  expect(getCalls).toEqual([SCOPE_B]);
  expect(records.has(SCOPE_B)).toBe(true);
  heldKeys.resolve([SCOPE_B]);
  await firstKeysFinished.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(deleteCalls).not.toContain(SCOPE_B);
  expect(records.has(SCOPE_B)).toBe(true);
  expect(setCalls).not.toContain(SCOPE_A);
});

it("releases the real Gate when an older storage write never settles, without restoring the new scope late", async () => {
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  releasePendingWrite = () => releaseWrite.resolve();
  const records = new Map<string, PersistedClient>();
  const getCalls: string[] = [];
  const setCalls: string[] = [];
  let keyCalls = 0;
  let heldAWrite = false;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      getCalls.push(key);
      return records.get(key);
    },
    set: async (key, value) => {
      setCalls.push(key);
      if (key === SCOPE_A && !heldAWrite) {
        heldAWrite = true;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => {
      keyCalls += 1;
      return [...records.keys()];
    },
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response("A data"))
    .mockResolvedValue(response("fresh B"));
  vi.stubGlobal("fetch", fetchMock);

  const clientA = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await bindActionQueryCache(clientA, SCOPE_A);
  records.set(SCOPE_B, persistedOwner("cached B"));
  const containerA = await mount(clientA, false);
  await waitForText(containerA, "A data");
  await writeStarted.promise;

  sessionState.set(USER_B);
  const clientB = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const containerB = await mount(clientB, true);
  await waitForText(containerB, "fresh B");
  expect(getCalls).not.toContain(SCOPE_B);
  expect(records.has(SCOPE_B)).toBe(true);
  expect(setCalls).toContain(SCOPE_A);

  releaseWrite.resolve();
  await expect.poll(() => keyCalls).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getCalls).not.toContain(SCOPE_B);
  expect(records.has(SCOPE_B)).toBe(true);
  expect(setCalls).not.toContain(SCOPE_B);
});
