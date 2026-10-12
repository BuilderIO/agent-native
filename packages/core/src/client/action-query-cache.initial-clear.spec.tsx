import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

const sessionState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let session: { email: string; userId: string; orgId: string } | null = null;
  return {
    read: () => session,
    subscribe(listener: () => void) {
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
        error: null,
        retry: () => {},
      };
    },
    isSessionFromFirstRead: () => false,
    recheckSessionAfterUnauthorized: vi.fn(),
  };
});
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import * as cache from "./action-query-cache.js";
import { clientBuildId } from "./build-compatibility.js";
import { useActionQuery } from "./use-action.js";

const USER_B = {
  email: "b@example.test",
  userId: "clear-barrier-b",
  orgId: "org-b",
};
const SCOPE_B = cache.actionQueryCacheScope(USER_B, clientBuildId());
const ACTION_KEY = ["action", "list-designs", undefined] as const;
type Owner = { owner: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function response(owner: string, status = 200): Response {
  return new Response(
    JSON.stringify(status === 200 ? { owner } : { error: "denied" }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(status === 200
          ? { "X-Agent-Native-Browser-Persist": "allow" }
          : {}),
      },
    },
  );
}

function cacheRecord(owner: string): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(ACTION_KEY, { owner }, { updatedAt: Date.now() - 10 });
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: importDehydrate(source),
  };
  source.clear();
  return record;
}

function importDehydrate(client: QueryClient) {
  // Kept local so the fixture records have the same TanStack shape as storage.
  return dehydrate(client);
}

import { dehydrate } from "@tanstack/react-query";

function OwnerProbe({ renders }: { renders: string[] }) {
  const query = useActionQuery<Owner>("list-designs" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const rendered = query.data?.owner ?? query.status;
  renders.push(rendered);
  return (
    <span data-testid="owner" data-status={query.status}>
      {rendered}
    </span>
  );
}

const mounted: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];
let releaseClear: (() => void) | undefined;
let pendingClear: Promise<void> | undefined;
let cleanupClear: (() => Promise<void>) | undefined;

async function mountGate(client: QueryClient, renders: string[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <cache.ActionQueryCacheGate>
          <OwnerProbe renders={renders} />
        </cache.ActionQueryCacheGate>
      </QueryClientProvider>,
    );
  });
  return container;
}

async function pollText(container: HTMLDivElement, expected: string) {
  await expect
    .poll(() => container.querySelector("[data-testid=owner]")?.textContent, {
      timeout: 5_000,
      interval: 20,
    })
    .toBe(expected);
}

function makeStorage(options: {
  records?: Map<string, PersistedClient>;
  clearBehavior: (call: number) => Promise<void>;
}) {
  const records = new Map(options.records);
  const gets: string[] = [];
  const sets: string[] = [];
  const keyScans: number[] = [];
  let clearCalls = 0;
  const storage: cache.ActionQueryCacheStorage = {
    async get(key) {
      gets.push(key);
      return records.get(key);
    },
    async set(key, value) {
      sets.push(key);
      records.set(key, value);
    },
    async del(key) {
      records.delete(key);
    },
    async keys() {
      keyScans.push(Date.now());
      return [...records.keys()];
    },
    async clear() {
      clearCalls += 1;
      await options.clearBehavior(clearCalls);
      records.clear();
    },
  };
  return {
    storage,
    records,
    gets,
    sets,
    keyScans,
    clearCalls: () => clearCalls,
  };
}

async function resetStorage(
  cache: typeof cache,
  storage: cache.ActionQueryCacheStorage,
) {
  cache.setActionQueryCacheStorage(storage);
  cleanupClear = async () => cache.clearActionQueryCache();
}

async function settle(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  releaseClear?.();
  releaseClear = undefined;
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
    entry.client.clear();
  }
  await pendingClear?.catch(() => {});
  pendingClear = undefined;
  if (cleanupClear) await cleanupClear().catch(() => {});
  cleanupClear = undefined;
  cache.setActionQueryCacheStorage(undefined);
  sessionState.set(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("releases the Gate after a timed-out clear only after scrubbing, with no late restore or persistence", async () => {
  const started = deferred<void>();
  const held = deferred<void>();
  const storage = makeStorage({
    records: new Map([[SCOPE_B, cacheRecord("disk B")]]),
    clearBehavior: async (call) => {
      if (call === 1) {
        started.resolve();
        await held.promise;
      }
    },
  });
  await resetStorage(cache, storage.storage);
  const clearCaller = cache.clearActionQueryCache();
  pendingClear = clearCaller.catch(() => {});
  await started.promise;

  const client = new QueryClient();
  client.setQueryData(ACTION_KEY, { owner: "stale prebind" });
  const fetchMock = vi.fn(async () => response("fresh B"));
  vi.stubGlobal("fetch", fetchMock);
  sessionState.set(USER_B);
  const renders: string[] = [];
  const container = await mountGate(client, renders);
  await pollText(container, "fresh B");
  expect(renders).not.toContain("stale prebind");
  expect(client.getQueryData(ACTION_KEY)).toEqual({ owner: "fresh B" });
  expect(storage.gets).toEqual([]);
  expect(storage.sets).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(clearCaller).rejects.toThrow(/timed out/i);

  held.resolve();
  await pendingClear;
  await settle(30);
  expect(storage.gets).toEqual([]);
  expect(storage.sets).toEqual([]);
  expect(storage.records.size).toBe(0);

  const laterClient = new QueryClient();
  await cache.bindActionQueryCache(laterClient, SCOPE_B);
  expect(storage.gets).toHaveLength(1);
  expect(storage.gets[0]).toContain(USER_B.userId);
  laterClient.clear();
});

it("keeps the waiting bind responsible for sanitation when a direct clear joins", async () => {
  const started = deferred<void>();
  const held = deferred<void>();
  const storage = makeStorage({
    records: new Map([[SCOPE_B, cacheRecord("disk B")]]),
    clearBehavior: async (call) => {
      if (call === 1) {
        started.resolve();
        await held.promise;
      }
    },
  });
  await resetStorage(cache, storage.storage);
  const initialClear = cache.clearActionQueryCache();
  pendingClear = initialClear;
  await started.promise;

  const client = new QueryClient();
  client.setQueryData(ACTION_KEY, { owner: "stale prebind" });
  const fetchMock = vi.fn(async () => response("fresh B"));
  vi.stubGlobal("fetch", fetchMock);
  sessionState.set(USER_B);
  const renders: string[] = [];
  const container = await mountGate(client, renders);
  const overlappingClear = cache.clearActionQueryCache();

  await settle(100);
  expect(container.textContent).toBe("");
  expect(client.getQueryData(ACTION_KEY)).toEqual({ owner: "stale prebind" });
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => {
    held.resolve();
    await Promise.all([initialClear, overlappingClear]);
  });
  await pollText(container, "fresh B");
  expect(renders).not.toContain("stale prebind");
  expect(client.getQueryData(ACTION_KEY)).toEqual({ owner: "fresh B" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(storage.gets).toHaveLength(1);
  expect(storage.gets[0]).toContain(USER_B.userId);
});

it("sanitizes a rejected clear before releasing the Gate and keeps the denial revoker active", async () => {
  const storage = makeStorage({
    records: new Map([[SCOPE_B, cacheRecord("disk B")]]),
    clearBehavior: async (call) => {
      if (call <= 2) throw new Error(`clear failed ${call}`);
    },
  });
  await resetStorage(cache, storage.storage);
  await expect(cache.clearActionQueryCache()).rejects.toThrow("clear failed 1");

  const client = new QueryClient();
  client.setQueryData(ACTION_KEY, { owner: "stale prebind" });
  const fetchMock = vi.fn(async () => response("denied", 403));
  vi.stubGlobal("fetch", fetchMock);
  sessionState.set(USER_B);
  const renders: string[] = [];
  const container = await mountGate(client, renders);
  await settle(150);
  await expect
    .poll(
      () =>
        container
          .querySelector("[data-testid=owner]")
          ?.getAttribute("data-status"),
      {
        timeout: 3_000,
        interval: 20,
      },
    )
    .toBe("error");
  expect(renders).not.toContain("stale prebind");
  expect(client.getQueryData(ACTION_KEY)).toBeUndefined();
  await expect.poll(() => storage.clearCalls()).toBe(3);
  expect(storage.gets).toEqual([]);
  expect(storage.sets).toEqual([]);
  expect(storage.records.size).toBe(0);

  const laterClient = new QueryClient();
  await cache.bindActionQueryCache(laterClient, SCOPE_B);
  expect(storage.gets).toHaveLength(1);
  expect(storage.gets[0]).toContain(USER_B.userId);
  laterClient.clear();
});

it("an obsolete timeout leaves a shared client untouched after a newer scope attempt starts", async () => {
  const started = deferred<void>();
  const held = deferred<void>();
  const storage = makeStorage({
    clearBehavior: async (call) => {
      if (call === 1) {
        started.resolve();
        await held.promise;
      }
    },
  });
  await resetStorage(cache, storage.storage);
  const clearCaller = cache.clearActionQueryCache();
  pendingClear = clearCaller.catch(() => {});
  await started.promise;

  const client = new QueryClient();
  const oldAttempt = cache.bindActionQueryCache(client, "old-scope");
  await settle(250);
  const newAttempt = cache.bindActionQueryCache(client, "new-scope");
  client.setQueryData(ACTION_KEY, { owner: "new scope live data" });

  await oldAttempt;
  expect(client.getQueryData(ACTION_KEY)).toEqual({
    owner: "new scope live data",
  });
  await newAttempt;
  expect(client.getQueryData(ACTION_KEY)).toBeUndefined();
  expect(storage.gets).toEqual([]);
  expect(storage.sets).toEqual([]);

  held.resolve();
  await expect(clearCaller).rejects.toThrow(/timed out/i);
  await pendingClear;
});
