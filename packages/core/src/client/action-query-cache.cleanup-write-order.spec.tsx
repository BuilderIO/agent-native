import "./action-query-cache.test-fixtures.js";
// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { ActionQueryCacheStorage } from "./action-query-cache.js";
import * as cacheModule from "./action-query-cache.js";
import { useActionQuery } from "./use-action.js";

const scopeA = "cleanup-write-race-a-20261012";
const scopeB = "cleanup-write-race-b-20261012";
const queryKey = ["action", "list-designs", undefined] as const;
const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function QueryProbe() {
  useActionQuery<{ owner: string }>("list-designs" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  return null;
}

async function mount(client: QueryClient) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <QueryProbe />
      </QueryClientProvider>,
    );
  });
}

const clients: QueryClient[] = [];
let releasePendingWrite: (() => void) | undefined;
const pendingBindings: Promise<void>[] = [];

afterEach(async () => {
  releasePendingWrite?.();
  await Promise.all(pendingBindings.splice(0));
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  await cacheModule.clearActionQueryCache();
  cacheModule.setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  releasePendingWrite = undefined;
});

it("waits for an old-scope write before enumerating cache keys for a new scope", async () => {
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  releasePendingWrite = () => releaseWrite.resolve();
  const records = new Map<string, PersistedClient>();
  const keySnapshots: string[][] = [];
  let heldScopeAWrite = false;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      if (key === scopeA && !heldScopeAWrite) {
        heldScopeAWrite = true;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => {
      const snapshot = [...records.keys()];
      keySnapshots.push(snapshot);
      return snapshot;
    },
    clear: async () => records.clear(),
  };
  cacheModule.setActionQueryCacheStorage(storage);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ owner: "scope-a" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Native-Browser-Persist": "allow",
          },
        }),
    ),
  );

  const clientA = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientA);
  await cacheModule.bindActionQueryCache(clientA, scopeA);
  await mount(clientA);
  await expect
    .poll(() => clientA.getQueryData(queryKey))
    .toEqual({ owner: "scope-a" });
  expect(keySnapshots).toHaveLength(1);
  await expect.poll(() => heldScopeAWrite).toBe(true);
  await writeStarted.promise;

  const clientB = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientB);
  let bindingFinished = false;
  const binding = cacheModule.bindActionQueryCache(clientB, scopeB).then(() => {
    bindingFinished = true;
  });
  pendingBindings.push(binding);
  await new Promise((resolve) => setTimeout(resolve, 0));

  let newestBindingFinished = false;
  let newestBinding: Promise<void> | undefined;
  try {
    console.log(
      "CLEANUP_WRITE_RACE_BEFORE_RELEASE " +
        JSON.stringify({ bindingFinished, keySnapshots }),
    );
    expect(bindingFinished).toBe(false);
    expect(keySnapshots).toHaveLength(1);

    const clientC = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(clientC);
    newestBinding = cacheModule
      .bindActionQueryCache(clientC, "cleanup-write-race-c-20261012")
      .then(() => {
        newestBindingFinished = true;
      });
    pendingBindings.push(newestBinding);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(newestBindingFinished).toBe(false);
    expect(keySnapshots).toHaveLength(1);

    releaseWrite.resolve();
    await Promise.all([binding, newestBinding]);
    expect(bindingFinished).toBe(true);
    expect(newestBindingFinished).toBe(true);
    expect(keySnapshots).toHaveLength(2);
    expect(keySnapshots[1]).toContain(scopeA);
    expect(records.has(scopeA)).toBe(false);
    expect(records.has(scopeB)).toBe(false);
  } finally {
    releaseWrite.resolve();
    await binding;
    if (newestBinding) await newestBinding;
    console.log(
      "CLEANUP_WRITE_RACE_AFTER_RELEASE " +
        JSON.stringify({
          bindingFinished,
          newestBindingFinished,
          keySnapshots,
          keys: [...records.keys()],
        }),
    );
  }
});
