// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  advanceMutationEpoch,
  readMutationEpoch,
  requestActionCacheFlush,
} from "./action-query-cache-mutation.js";

type StampedRecord = PersistedClient & { mutationEpoch?: string | null };

let cache: typeof import("./action-query-cache.js");
let action: typeof import("./use-action.js");
let writes: StampedRecord[];
let client: QueryClient;

function saveQuery(value: string) {
  const key = ["action", "get-calendar", undefined];
  client.setQueryData(key, { color: value });
  const query = client.getQueryCache().find({ queryKey: key });
  if (query)
    action.markRestoredBrowserPersistableActionQuery(
      query,
      action.currentActionQueryCacheBinding(),
    );
  client.setQueryData(key, { color: value, marked: true });
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cache = await import("./action-query-cache.js");
  action = await import("./use-action.js");
  writes = [];
  cache.setActionQueryCacheStorage({
    get: async () => undefined,
    set: async (_key, value) => {
      writes.push(value);
    },
    del: async () => {},
    keys: async () => [],
    clear: async () => {},
  });
  client = new QueryClient();
  await cache.bindActionQueryCache(client, `own-epoch-${crypto.randomUUID()}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  client.clear();
  vi.useRealTimers();
  localStorage.clear();
});

it("adopts its own mutation epoch after the refetch settles", async () => {
  saveQuery("red");
  advanceMutationEpoch();
  const ownEpoch = readMutationEpoch();
  expect(ownEpoch).not.toBeNull();

  saveQuery("blue");
  requestActionCacheFlush(ownEpoch);
  await vi.advanceTimersByTimeAsync(1_000);

  expect(writes.at(-1)?.mutationEpoch).toBe(ownEpoch);
});

it("does not adopt an epoch bumped by another tab", async () => {
  saveQuery("red");
  advanceMutationEpoch();
  const ownEpoch = readMutationEpoch();
  window.localStorage.setItem(
    "agent-native.action-query-cache.mutation-epoch",
    "other-tab-epoch",
  );

  saveQuery("blue");
  requestActionCacheFlush(ownEpoch);
  await vi.advanceTimersByTimeAsync(1_000);

  expect(writes.at(-1)?.mutationEpoch).toBeNull();
});

it("stamps later writes with its own epoch even when nothing was pending at settle", async () => {
  advanceMutationEpoch();
  const ownEpoch = readMutationEpoch();
  requestActionCacheFlush(ownEpoch);

  saveQuery("blue");
  await vi.advanceTimersByTimeAsync(1_000);

  expect(writes.at(-1)?.mutationEpoch).toBe(ownEpoch);
});

it("keeps the stamped epoch when the settled epoch is not a current string", async () => {
  saveQuery("red");
  requestActionCacheFlush(null);
  await vi.advanceTimersByTimeAsync(1_000);

  expect(writes.at(-1)?.mutationEpoch).toBeNull();
});
