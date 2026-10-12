// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
let scope = "";
const queryKey = ["action", "retry-overlap-diagnostic"] as const;
const clients: QueryClient[] = [];
const records = new Map<string, PersistedClient>();
const oldData = { value: "old allowed result" };
const freshData = { value: "new allowed result" };
let rejectFirstDelete = false;
let deleteAttempts = 0;
let retryStarted: (() => void) | undefined;
let releaseRetry: (() => void) | undefined;
let retryStartedPromise!: Promise<void>;
let retryReleasePromise!: Promise<void>;

function persistedRecord(value = oldData): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, value);
  const record = {
    timestamp: Date.now(),
    buster: "action-query-cache-v1",
    clientState: dehydrate(source),
  };
  source.clear();
  return record;
}

const storage: ActionQueryCacheStorage = {
  get: async (key) => records.get(key),
  set: async (key, value) => {
    records.set(key, value);
  },
  del: async (key) => {
    deleteAttempts += 1;
    if (rejectFirstDelete && deleteAttempts === 1) {
      rejectFirstDelete = false;
      throw new Error("diagnostic first delete failure");
    }
    if (deleteAttempts === 2) {
      retryStarted?.();
      await retryReleasePromise;
      records.delete(key);
      return;
    }
    records.delete(key);
  },
  keys: async () => [...records.keys()],
  clear: async () => records.clear(),
};

beforeEach(() => {
  scope = `retry-overlap-${crypto.randomUUID()}`;
  rejectFirstDelete = false;
  deleteAttempts = 0;
  retryStartedPromise = new Promise<void>((resolve) => {
    retryStarted = resolve;
  });
  retryReleasePromise = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
});

afterEach(async () => {
  releaseRetry?.();
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
  records.clear();
  vi.restoreAllMocks();
});

async function startRevocation(
  bind: typeof bindActionQueryCache,
): Promise<QueryClient> {
  records.set(scope, persistedRecord());
  setActionQueryCacheStorage(storage);
  setActionQueryCacheStorage(storage);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  await bind(client, scope);
  expect(client.getQueryData(queryKey)).toEqual(oldData);

  rejectFirstDelete = true;
  await expect(
    client.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect.poll(() => deleteAttempts).toBe(1);
  await expect.poll(() => records.has(scope)).toBe(true);
  return client;
}

it("makes a same-scope bind wait for an in-flight retry delete", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await startRevocation(bindActionQueryCache);

  const clientB = new QueryClient();
  clients.push(clientB);
  const bindB = bindActionQueryCache(clientB, scope);
  await retryStartedPromise;

  const clientC = new QueryClient();
  clients.push(clientC);
  let bindCFinished = false;
  const bindC = bindActionQueryCache(clientC, scope).then(() => {
    bindCFinished = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(deleteAttempts).toBe(2);
  expect(bindCFinished).toBe(false);
  releaseRetry?.();
  await Promise.all([bindB, bindC]);
  expect(records.has(scope)).toBe(false);

  records.set(scope, persistedRecord(freshData));
  const clientD = new QueryClient();
  clients.push(clientD);
  await bindActionQueryCache(clientD, scope);
  expect(clientD.getQueryData(queryKey)).toEqual(freshData);
  expect(records.has(scope)).toBe(true);
});
