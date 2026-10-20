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
const queryKey = ["action", "delete-reject-rebind-diagnostic"] as const;
const clients: QueryClient[] = [];
const records = new Map<string, PersistedClient>();
const oldData = { value: "old authorized result" };
let rejectedDeletesRemaining = 0;
let deleteAttempts = 0;
let clearAttempts = 0;
let clearCompletions = 0;
let readAfterSuccessfulClear = false;

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
    if (key === scope && clearAttempts > 0) {
      readAfterSuccessfulClear = clearCompletions === clearAttempts;
    }
    return records.get(key);
  },
  set: async (key, value) => {
    records.set(key, value);
  },
  del: async (key) => {
    deleteAttempts += 1;
    if (rejectedDeletesRemaining > 0) {
      rejectedDeletesRemaining -= 1;
      throw new Error("diagnostic storage delete failure");
    }
    records.delete(key);
  },
  keys: async () => [...records.keys()],
  clear: async () => {
    clearAttempts += 1;
    records.clear();
    clearCompletions = clearAttempts;
  },
};

beforeEach(() => {
  scope = `delete-reject-rebind-${crypto.randomUUID()}`;
  rejectedDeletesRemaining = 0;
  deleteAttempts = 0;
  clearAttempts = 0;
  clearCompletions = 0;
  readAfterSuccessfulClear = false;
});

afterEach(async () => {
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
  records.clear();
  rejectedDeletesRemaining = 0;
  deleteAttempts = 0;
  clearAttempts = 0;
  clearCompletions = 0;
  readAfterSuccessfulClear = false;
  vi.restoreAllMocks();
});

it("clears persisted scopes after a rejected delete before a new bind can restore", async () => {
  records.set(scope, persistedRecord());
  setActionQueryCacheStorage(storage);
  setActionQueryCacheStorage(storage);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const clientA = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientA);
  await bindActionQueryCache(clientA, scope);
  expect(clientA.getQueryData(queryKey)).toEqual(oldData);

  rejectedDeletesRemaining = 2;
  await expect(
    clientA.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect.poll(() => warn.mock.calls.length).toBeGreaterThan(0);
  expect(records.has(scope)).toBe(true);

  const clientB = new QueryClient();
  clients.push(clientB);
  await bindActionQueryCache(clientB, scope);
  expect(deleteAttempts).toBe(1);
  expect(clearAttempts).toBe(1);
  expect(readAfterSuccessfulClear).toBe(true);
  expect(records.has(scope)).toBe(false);
  expect(clientB.getQueryData(queryKey)).toBeUndefined();

  const clientC = new QueryClient();
  clients.push(clientC);
  await bindActionQueryCache(clientC, scope);
  expect(deleteAttempts).toBe(1);
  expect(clearAttempts).toBe(1);
  expect(records.has(scope)).toBe(false);
  expect(clientC.getQueryData(queryKey)).toBeUndefined();

  const freshData = { value: "fresh result after successful delete" };
  records.set(scope, persistedRecord(freshData));
  const clientD = new QueryClient();
  clients.push(clientD);
  await bindActionQueryCache(clientD, scope);
  expect(clientD.getQueryData(queryKey)).toEqual(freshData);
});

it("preserves a cached success when an action refetch receives 503", async () => {
  records.set(scope, persistedRecord());
  setActionQueryCacheStorage(storage);
  setActionQueryCacheStorage(storage);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  await bindActionQueryCache(client, scope);
  expect(client.getQueryData(queryKey)).toEqual(oldData);

  await expect(
    client.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("temporarily unavailable"), {
          status: 503,
        });
      },
    }),
  ).rejects.toMatchObject({ status: 503 });

  expect(client.getQueryData(queryKey)).toEqual(oldData);
  expect(records.has(scope)).toBe(true);
  expect(deleteAttempts).toBe(0);
});
