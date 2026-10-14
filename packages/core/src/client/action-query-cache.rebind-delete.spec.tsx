import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";

import {
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

const scope = "same-scope-delete-proof-20261012";
const queryKey = ["action", "same-scope-delete-proof"] as const;
const clients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function persistedRecord(): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, { value: "old allowed value" });
  return {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
}

afterEach(async () => {
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
});

it("waits for a pending same-scope denial delete before reading storage again", async () => {
  const records = new Map<string, PersistedClient>([
    [scope, persistedRecord()],
  ]);
  const deleteStarted = deferred<void>();
  const releaseDelete = deferred<void>();
  const calls: string[] = [];
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      calls.push("get:" + key);
      return records.get(key);
    },
    set: async (key, value) => {
      calls.push("set:" + key);
      records.set(key, value);
    },
    del: async (key) => {
      calls.push("del:start:" + key);
      deleteStarted.resolve();
      await releaseDelete.promise;
      records.delete(key);
      calls.push("del:end:" + key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);

  const clientA = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientA);
  await bindActionQueryCache(clientA, scope);
  expect(clientA.getQueryData(queryKey)).toEqual({
    value: "old allowed value",
  });

  await expect(
    clientA.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await deleteStarted.promise;
  expect(clientA.getQueryData(queryKey)).toBeUndefined();

  const clientB = new QueryClient();
  clients.push(clientB);
  let bindingFinished = false;
  const binding = bindActionQueryCache(clientB, scope).then(() => {
    bindingFinished = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(bindingFinished).toBe(false);
  expect(calls.filter((call) => call === "get:" + scope)).toHaveLength(1);
  expect(records.has(scope)).toBe(true);

  releaseDelete.resolve();
  await binding;

  expect(calls.indexOf("del:end:" + scope)).toBeLessThan(
    calls.indexOf("get:" + scope, 1),
  );
  expect(records.has(scope)).toBe(false);
  expect(clientB.getQueryData(queryKey)).toBeUndefined();
});
