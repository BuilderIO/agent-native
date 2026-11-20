// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { requestActionCacheFlush } from "./action-query-cache-mutation.js";

const epochKey = "agent-native.action-query-cache.epoch";
const intentPrefix = "agent-native.action-query-cache.clear-required:";
const WRITE_DELAY_MS = 1_000;
const NOTIFICATIONS = 40;

let cache: typeof import("./action-query-cache.js");
let action: typeof import("./use-action.js");
let writes: PersistedClient[];
let client: QueryClient;
let scope: string;

function unrelatedKeys(count: number) {
  for (let i = 0; i < count; i += 1) {
    localStorage.setItem(`unrelated-origin-key-${i}`, `value-${i}`);
  }
}

function notify(from: number, to: number) {
  for (let i = from; i < to; i += 1) {
    const key = ["action", `item-${i}`, undefined];
    client.setQueryData(key, { i });
    const query = client.getQueryCache().find({ queryKey: key });
    if (query)
      action.markRestoredBrowserPersistableActionQuery(
        query,
        action.currentActionQueryCacheBinding(),
      );
    client.setQueryData(key, { i, marked: true });
  }
}

function countStorageAccess() {
  return {
    key: vi.spyOn(window.localStorage, "key"),
    getItem: vi.spyOn(window.localStorage, "getItem"),
  };
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
  scope = `coalesce-${crypto.randomUUID()}`;
  client = new QueryClient();
  await cache.bindActionQueryCache(client, scope);
  unrelatedKeys(300);
});

afterEach(async () => {
  vi.restoreAllMocks();
  client.clear();
  vi.useRealTimers();
  localStorage.clear();
});

it("coalesces notifications into one write without scanning localStorage per notification", async () => {
  notify(0, 1);
  const access = countStorageAccess();
  notify(1, NOTIFICATIONS);
  expect(access.key).not.toHaveBeenCalled();
  expect(access.getItem).not.toHaveBeenCalled();
  access.key.mockClear();

  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);

  expect(writes).toHaveLength(1);
  expect(writes[0].clientState.queries).toHaveLength(NOTIFICATIONS);
  expect(access.key).toHaveBeenCalled();
});

it("refuses the pending write when the epoch changes before the delay elapses", async () => {
  notify(0, NOTIFICATIONS);
  localStorage.setItem(epochKey, "another-tab-epoch");

  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

  expect(writes).toEqual([]);
});

it("refuses the pending write when a durable clear intent appears before the delay elapses", async () => {
  notify(0, NOTIFICATIONS);
  localStorage.setItem(`${intentPrefix}pending`, "pending");

  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

  expect(writes).toEqual([]);
});

it("refuses notifications after an epoch change without queuing a write", async () => {
  notify(0, 1);
  localStorage.setItem(epochKey, "another-tab-epoch");
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
  notify(1, NOTIFICATIONS);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

  expect(writes).toEqual([]);
});

it("refuses the pending write when a clear's intent is removed before the flush after its epoch write failed", async () => {
  const intentKey = `${intentPrefix}transient`;
  const epoch = localStorage.getItem(epochKey);
  notify(0, 1);
  localStorage.setItem(intentKey, "transient");
  notify(1, NOTIFICATIONS);
  localStorage.removeItem(intentKey);
  expect(localStorage.getItem(epochKey)).toBe(epoch);

  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);
  notify(NOTIFICATIONS, NOTIFICATIONS + 1);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

  expect(writes).toEqual([]);
});

it("refuses the pending write when another tab's clear intent comes and goes without a notification", async () => {
  const intentKey = `${intentPrefix}transient`;
  notify(0, NOTIFICATIONS);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: intentKey,
      newValue: "transient",
      storageArea: localStorage,
    }),
  );
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: intentKey,
      oldValue: "transient",
      newValue: null,
      storageArea: localStorage,
    }),
  );

  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

  expect(writes).toEqual([]);
});

it("saves the pending write as soon as a mutation succeeds, so a reload right after it restores the written state", async () => {
  notify(0, NOTIFICATIONS);
  requestActionCacheFlush();
  await vi.advanceTimersByTimeAsync(0);

  expect(writes).toHaveLength(1);
  expect(writes[0].clientState.queries).toHaveLength(NOTIFICATIONS);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);
  expect(writes).toHaveLength(1);
});

it("keeps coalescing sync activity, which fires on every run-event batch", async () => {
  notify(0, NOTIFICATIONS);
  window.dispatchEvent(new Event("agentNative:syncActivity"));
  await vi.advanceTimersByTimeAsync(0);

  expect(writes).toEqual([]);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);
  expect(writes).toHaveLength(1);
});

it("cancels the pending timer when it flushes, so a later change still waits the full delay", async () => {
  notify(0, 1);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS / 2);
  requestActionCacheFlush();
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toHaveLength(1);

  notify(1, 2);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS / 2 + 1);
  expect(writes).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS);
  expect(writes).toHaveLength(2);
});

it("saves the pending write when the document becomes hidden, not when it becomes visible", async () => {
  let state: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
  notify(0, NOTIFICATIONS);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toEqual([]);

  state = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toHaveLength(1);
});

it("removes its flush listeners when the binding closes", async () => {
  const windowRemove = vi.spyOn(window, "removeEventListener");
  const documentRemove = vi.spyOn(document, "removeEventListener");

  await cache.clearActionQueryCache(client);

  const windowEvents = windowRemove.mock.calls.map(([type]) => type);
  expect(windowEvents).toContain("agentNative:actionCacheFlush");
  expect(windowEvents).toContain("pagehide");
  expect(documentRemove.mock.calls.map(([type]) => type)).toContain(
    "visibilitychange",
  );
});

it("saves the pending write when the page is hidden", async () => {
  notify(0, NOTIFICATIONS);
  window.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);

  expect(writes).toHaveLength(1);
});

it("does not write on a mutation signal with nothing pending", async () => {
  requestActionCacheFlush();
  await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS * 2);

  expect(writes).toEqual([]);
});
