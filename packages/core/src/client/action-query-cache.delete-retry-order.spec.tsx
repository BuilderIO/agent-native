import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

let scope = "";
const queryKey = ["action", "delete-failure-clear-order"] as const;
const clients: QueryClient[] = [];
const records = new Map<string, PersistedClient>();
const storageEvents: string[] = [];
const oldData = { value: "old allowed result" };
const freshData = { value: "new allowed result" };
let rejectNextDelete = false;
let deleteAttempts = 0;
let clearAttempts = 0;

function persistedRecord(value = oldData): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, value);
  const record = {
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
    storageEvents.push(`set:${key}`);
    records.set(key, value);
  },
  del: async (key) => {
    storageEvents.push(`del:${key}`);
    deleteAttempts += 1;
    if (rejectNextDelete) {
      rejectNextDelete = false;
      throw new Error("diagnostic storage delete failure");
    }
    records.delete(key);
  },
  keys: async () => {
    storageEvents.push("keys");
    return [...records.keys()];
  },
  clear: async () => {
    clearAttempts += 1;
    storageEvents.push("clear:start");
    records.clear();
    storageEvents.push("clear:end");
  },
};

beforeEach(() => {
  scope = `delete-failure-${crypto.randomUUID()}`;
  rejectNextDelete = false;
  deleteAttempts = 0;
  clearAttempts = 0;
  storageEvents.length = 0;
});

afterEach(async () => {
  await clearActionQueryCache().catch(() => {});
  setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
  records.clear();
  storageEvents.length = 0;
  vi.restoreAllMocks();
});

it("clears persisted results before a same-scope bind can restore after delete rejection", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  records.set(scope, persistedRecord());
  setActionQueryCacheStorage(storage);

  const clientA = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientA);
  await bindActionQueryCache(clientA, scope);
  expect(clientA.getQueryData(queryKey)).toEqual(oldData);

  rejectNextDelete = true;
  await expect(
    clientA.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect.poll(() => deleteAttempts).toBe(1);
  expect(records.has(scope)).toBe(true);

  storageEvents.length = 0;
  const clientB = new QueryClient();
  clients.push(clientB);
  await bindActionQueryCache(clientB, scope);

  const clearFinished = storageEvents.indexOf("clear:end");
  const scopeRead = storageEvents.indexOf(`get:${scope}`);
  expect(clearAttempts).toBe(1);
  expect(deleteAttempts).toBe(1);
  expect(clearFinished).toBeGreaterThanOrEqual(0);
  expect(scopeRead).toBeGreaterThan(clearFinished);
  expect(records.has(scope)).toBe(false);
  expect(clientB.getQueryData(queryKey)).toBeUndefined();

  records.set(scope, persistedRecord(freshData));
  const clientC = new QueryClient();
  clients.push(clientC);
  await bindActionQueryCache(clientC, scope);
  expect(clientC.getQueryData(queryKey)).toEqual(freshData);
});
