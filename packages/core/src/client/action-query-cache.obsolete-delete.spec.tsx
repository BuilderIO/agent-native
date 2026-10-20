import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import * as cache from "./action-query-cache.js";
import type { ActionQueryCacheStorage } from "./action-query-cache.js";
// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

const queryKey = ["action", "obsolete-scope-delete"] as const;
const scopeA = "obsolete-scope-delete-a";
const scopeB = "obsolete-scope-delete-b";
const oldData = { value: "cached result from scope A" };
const records = new Map<string, PersistedClient>();
const clients: QueryClient[] = [];
const deleteCalls: string[] = [];
const storageEvents: string[] = [];
let clearCalls = 0;
let rejectADeletesRemaining = 1;

function persistedRecord(): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, oldData, { updatedAt: Date.now() - 100 });
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  source.clear();
  return record;
}

const storage: ActionQueryCacheStorage = {
  get: async (key) => {
    storageEvents.push(`get:${key}`);
    return records.get(key);
  },
  set: async (key, value) => {
    records.set(key, value);
  },
  del: async (key) => {
    deleteCalls.push(key);
    storageEvents.push(`del:${key}`);
    if (key === scopeA && rejectADeletesRemaining > 0) {
      rejectADeletesRemaining -= 1;
      throw new Error("obsolete-scope delete failure");
    }
    records.delete(key);
  },
  keys: async () => {
    storageEvents.push("keys");
    return [...records.keys()];
  },
  clear: async () => {
    clearCalls += 1;
    storageEvents.push("clear:start");
    records.clear();
    storageEvents.push("clear:end");
  },
};

beforeEach(() => {
  records.clear();
  deleteCalls.length = 0;
  storageEvents.length = 0;
  clearCalls = 0;
  rejectADeletesRemaining = 1;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  cache.setActionQueryCacheStorage(storage);
});

afterEach(async () => {
  await cache.clearActionQueryCache();
  cache.setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
  records.clear();
  deleteCalls.length = 0;
  storageEvents.length = 0;
  clearCalls = 0;
  vi.restoreAllMocks();
});

it("clears a failed obsolete-scope delete before that scope can restore", async () => {
  records.set(scopeA, persistedRecord());

  const clientB = new QueryClient();
  clients.push(clientB);
  await expect(cache.bindActionQueryCache(clientB, scopeB)).rejects.toThrow(
    "obsolete-scope delete failure",
  );
  expect(deleteCalls).toEqual([scopeA]);
  expect(records.has(scopeA)).toBe(true);

  const clientA = new QueryClient();
  clients.push(clientA);
  await cache.bindActionQueryCache(clientA, scopeA);

  expect(clientA.getQueryData(queryKey)).toBeUndefined();
  expect(deleteCalls).toEqual([scopeA]);
  expect(clearCalls).toBe(1);
  expect(records.has(scopeA)).toBe(false);
  expect(storageEvents.indexOf("clear:end")).toBeLessThan(
    storageEvents.lastIndexOf(`get:${scopeA}`),
  );
});

it("does not restore an obsolete scope after its delete failure triggers a clear", async () => {
  records.set(scopeA, persistedRecord());
  rejectADeletesRemaining = 2;

  const clientB = new QueryClient();
  clients.push(clientB);
  await expect(cache.bindActionQueryCache(clientB, scopeB)).rejects.toThrow(
    "obsolete-scope delete failure",
  );

  const clientA = new QueryClient();
  clients.push(clientA);
  await cache.bindActionQueryCache(clientA, scopeA);

  expect(deleteCalls).toEqual([scopeA]);
  expect(clearCalls).toBe(1);
  expect(records.has(scopeA)).toBe(false);
  expect(clientA.getQueryData(queryKey)).toBeUndefined();
});
