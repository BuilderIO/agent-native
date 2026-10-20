// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ActionQueryCacheStorage } from "./action-query-cache.js";

vi.mock("./use-session.js", () => ({
  useSession: () => ({ session: null, status: "unavailable", isLoading: true }),
  isSessionFromFirstRead: () => false,
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

let first: typeof import("./action-query-cache.js");
let cold: typeof import("./action-query-cache.js");
let QueryClientCtor: typeof import("@tanstack/react-query").QueryClient;
let dehydrate: typeof import("@tanstack/react-query").dehydrate;

const scope = JSON.stringify(["review-user", "review-org", "build"]);
const queryKey = ["action", "get-private-data", undefined] as const;
const oldData = { secretLabel: "previously allowed" };
const epochKey = "agent-native.action-query-cache.epoch";
const markerPrefix = "agent-native.action-query-cache.clear-required:";
const initialEpoch = "initial-test-epoch";
const peerEpoch = "peer-cleared-epoch";
const concurrentEpoch = "newer-tab-clear-epoch";
const records = new Map<string, PersistedClient>();
const events: string[] = [];
const durableValues = new Map<string, string>();
let interleaveClearBeforeEpochProbeWrite = false;
let epochProbeWriteArmed = false;
let interleavedClearCompleted = false;
let rejectNextDelete = false;
let localStorageReadFails = false;
let localStorageWriteFails = false;
let localStorageMarkerWriteFails = false;
let rejectNextClear = false;
let clearCallCount = 0;
const clearGates = new Map<
  number,
  {
    started: Promise<void>;
    start: () => void;
    blocked: Promise<void>;
    release: () => void;
  }
>();
let holdNextSet = false;
let setStarted!: Promise<void>;
let setStartedResolve!: () => void;
let setRelease!: Promise<void>;
let releaseSetResolve!: () => void;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type DeleteGate = {
  started: Promise<void>;
  start: () => void;
  blocked: Promise<void>;
  release: () => void;
};
let queuedDeleteGate: DeleteGate | undefined;
let activeDeleteGate: DeleteGate | undefined;

function makeDeleteGate(): DeleteGate {
  const started = deferred();
  const blocked = deferred();
  return {
    started: started.promise,
    start: started.resolve,
    blocked: blocked.promise,
    release: blocked.resolve,
  };
}

function persisted(value = oldData, epoch = initialEpoch): PersistedClient {
  const source = new QueryClientCtor();
  source.setQueryData(queryKey, value, { updatedAt: Date.now() - 100 });
  const result = {
    timestamp: Date.now(),
    buster: `action-query-cache-v1:${epoch}`,
    clientState: dehydrate(source),
  };
  source.clear();
  return result;
}

const storage: ActionQueryCacheStorage = {
  async get(key) {
    events.push(`get:${key}`);
    return records.get(key);
  },
  async set(key, value) {
    events.push(`set:${key}`);
    if (holdNextSet) {
      holdNextSet = false;
      setStartedResolve();
      await setRelease;
    }
    records.set(key, value);
  },
  async del(key) {
    events.push(`del:${key}`);
    const gate = queuedDeleteGate;
    if (gate) {
      queuedDeleteGate = undefined;
      activeDeleteGate = gate;
      gate.start();
      await gate.blocked;
      activeDeleteGate = undefined;
    }
    if (rejectNextDelete) {
      rejectNextDelete = false;
      throw new Error("simulated transient delete failure");
    }
    records.delete(key);
    events.push(`del:done:${key}`);
  },
  async keys() {
    events.push("keys");
    return [...records.keys()];
  },
  async clear() {
    const call = ++clearCallCount;
    events.push(`clear:start:${call}`);
    const gate = clearGates.get(call);
    gate?.start();
    if (gate) await gate.blocked;
    if (rejectNextClear) {
      rejectNextClear = false;
      throw new Error("simulated storage clear failure");
    }
    records.clear();
    events.push(`clear:end:${call}`);
  },
};

function addClearGate(call: number) {
  const started = deferred();
  const blocked = deferred();
  clearGates.set(call, {
    started: started.promise,
    start: started.resolve,
    blocked: blocked.promise,
    release: blocked.resolve,
  });
  return { started: started.promise, release: blocked.resolve };
}

function pendingIntentKeys(): string[] {
  return [...durableValues.keys()].filter((key) =>
    key.startsWith(markerPrefix),
  );
}

function stubSafetyStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        if (localStorageReadFails) throw new Error("localStorage blocked");
        return durableValues.size;
      },
      key: (index: number) => {
        if (localStorageReadFails) throw new Error("localStorage blocked");
        return [...durableValues.keys()][index] ?? null;
      },
      getItem: (key: string) => {
        if (localStorageReadFails) throw new Error("localStorage blocked");
        const value = durableValues.get(key) ?? null;
        if (key === epochKey && interleaveClearBeforeEpochProbeWrite) {
          epochProbeWriteArmed = true;
        }
        return value;
      },
      setItem: (key: string, value: string) => {
        if (
          localStorageWriteFails ||
          (localStorageMarkerWriteFails && key.startsWith(markerPrefix))
        ) {
          throw new Error("localStorage quota exceeded");
        }
        if (
          interleaveClearBeforeEpochProbeWrite &&
          epochProbeWriteArmed &&
          !interleavedClearCompleted
        ) {
          epochProbeWriteArmed = false;
          interleavedClearCompleted = true;
          const marker = `${markerPrefix}tab-b-clear`;
          durableValues.set(marker, "tab-b-clear");
          durableValues.set(epochKey, concurrentEpoch);
          records.clear();
          durableValues.delete(marker);
          events.push("tab-b:clear-complete");
        }
        durableValues.set(key, value);
      },
      removeItem: (key: string) => {
        durableValues.delete(key);
      },
    },
  });
}

beforeEach(async () => {
  vi.resetModules();
  const query = await import("@tanstack/react-query");
  first = await import("./action-query-cache.js");
  vi.resetModules();
  cold = await import("./action-query-cache.js");
  QueryClientCtor = query.QueryClient;
  dehydrate = query.dehydrate;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubSafetyStorage();
  records.clear();
  events.length = 0;
  rejectNextDelete = false;
  localStorageReadFails = false;
  localStorageWriteFails = false;
  localStorageMarkerWriteFails = false;
  rejectNextClear = false;
  clearCallCount = 0;
  clearGates.clear();
  holdNextSet = false;
  queuedDeleteGate = undefined;
  activeDeleteGate = undefined;
  const setStart = deferred();
  const setDone = deferred();
  setStarted = setStart.promise;
  setStartedResolve = setStart.resolve;
  setRelease = setDone.promise;
  releaseSetResolve = setDone.resolve;
  durableValues.clear();
  durableValues.set(epochKey, initialEpoch);
  interleaveClearBeforeEpochProbeWrite = false;
  epochProbeWriteArmed = false;
  interleavedClearCompleted = false;
  first.setActionQueryCacheStorage(storage);
  cold.setActionQueryCacheStorage(storage);
});

afterEach(async () => {
  for (const gate of clearGates.values()) gate.release();
  queuedDeleteGate?.release();
  activeDeleteGate?.release();
  releaseSetResolve();
  await Promise.allSettled([
    first.clearActionQueryCache(),
    cold.clearActionQueryCache(),
  ]);
  first.setActionQueryCacheStorage(undefined);
  cold.setActionQueryCacheStorage(undefined);
  records.clear();
  durableValues.clear();
  events.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("durably blocks a cold same-scope restore after a revocation delete fails", async () => {
  records.set(scope, persisted());
  const firstClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await first.bindActionQueryCache(firstClient, scope);
  expect(firstClient.getQueryData(queryKey)).toEqual(oldData);

  rejectNextDelete = true;
  await expect(
    firstClient.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect
    .poll(() => events.filter((event) => event === `del:${scope}`).length)
    .toBe(1);
  expect(records.has(scope)).toBe(true);
  expect(pendingIntentKeys().length).toBeGreaterThan(0);

  const coldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await first.bindActionQueryCache(coldClient, scope);
  expect(coldClient.getQueryData(queryKey)).toBeUndefined();
  expect(records.has(scope)).toBe(false);
  expect(pendingIntentKeys()).toEqual([]);
});

it("marks durable clear intent before a revoked scope delete settles", async () => {
  records.set(scope, persisted());
  const firstClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await first.bindActionQueryCache(firstClient, scope);
  expect(firstClient.getQueryData(queryKey)).toEqual(oldData);

  const deleteGate = makeDeleteGate();
  queuedDeleteGate = deleteGate;
  await expect(
    firstClient.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await deleteGate.started;
  expect(records.has(scope)).toBe(true);
  const intentCountAtReload = pendingIntentKeys().length;

  vi.resetModules();
  cold = await import("./action-query-cache.js");
  cold.setActionQueryCacheStorage(storage);
  const coldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await cold.bindActionQueryCache(coldClient, scope);

  expect(coldClient.getQueryData(queryKey)).toBeUndefined();
  expect(intentCountAtReload).toBeGreaterThan(0);
  expect(records.has(scope)).toBe(false);
  expect(pendingIntentKeys()).toEqual([]);

  deleteGate.release();
  await expect.poll(() => events.includes(`del:done:${scope}`)).toBe(true);
});

it("rejects a timed-out clear caller and keeps cold binds behind durable clear intent", async () => {
  records.set(scope, persisted());
  const clear1 = addClearGate(1);
  const caller = first.clearActionQueryCache();
  await clear1.started;
  await expect(caller).rejects.toThrow(/timed out/i);
  expect(pendingIntentKeys().length).toBeGreaterThan(0);
  expect(events).not.toContain("clear:end:1");

  const clear2 = addClearGate(2);
  const coldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  const coldBind = cold.bindActionQueryCache(coldClient, scope);
  await clear2.started;
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  expect(coldClient.getQueryData(queryKey)).toBeUndefined();
  expect(events).not.toContain(`get:${scope}`);
  expect(pendingIntentKeys()).toHaveLength(2);

  clear2.release();
  await coldBind;
  await expect.poll(() => events.includes("clear:end:2")).toBe(true);
  expect(records.has(scope)).toBe(false);
  expect(pendingIntentKeys()).toEqual([]);
  clear1.release();
  await expect.poll(() => events.includes("clear:end:1")).toBe(true);
});

it("retains clear intent after a failed storage clear until a later clear succeeds", async () => {
  records.set(scope, persisted());
  rejectNextClear = true;
  await expect(first.clearActionQueryCache()).rejects.toThrow(
    /simulated storage clear failure/,
  );
  expect(records.has(scope)).toBe(true);
  expect(pendingIntentKeys().length).toBeGreaterThan(0);

  const coldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await cold.bindActionQueryCache(coldClient, scope);
  expect(coldClient.getQueryData(queryKey)).toBeUndefined();
  expect(records.has(scope)).toBe(false);
  expect(pendingIntentKeys()).toEqual([]);
});

it("does not restore a late old-tab write after another tab clears and advances the epoch", async () => {
  records.set(scope, persisted());
  const oldTab = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await first.bindActionQueryCache(oldTab, scope);
  expect(oldTab.getQueryData(queryKey)).toEqual(oldData);

  holdNextSet = true;
  oldTab.setQueryData(queryKey, { secretLabel: "late old-tab value" });
  await setStarted;

  await cold.clearActionQueryCache();
  expect(records.has(scope)).toBe(false);
  releaseSetResolve();
  await expect.poll(() => records.has(scope)).toBe(true);
  const lateRecord = records.get(scope);
  expect(lateRecord?.buster).toBe(`action-query-cache-v1:${initialEpoch}`);

  const newTab = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await cold.bindActionQueryCache(newTab, scope);
  expect(newTab.getQueryData(queryKey)).toBeUndefined();
  expect(records.has(scope)).toBe(false);
});

it.each(["read", "write"] as const)(
  "fails closed when localStorage %s access is blocked",
  async (kind) => {
    records.set(scope, persisted());
    if (kind === "read") localStorageReadFails = true;
    else localStorageWriteFails = true;
    const client = new QueryClientCtor({
      defaultOptions: { queries: { retry: false } },
    });
    const readsBefore = events.filter(
      (event) => event === `get:${scope}`,
    ).length;
    await cold.bindActionQueryCache(client, scope);
    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(events.filter((event) => event === `get:${scope}`).length).toBe(
      readsBefore,
    );
    expect(records.has(scope)).toBe(true);
  },
);

it("rejects old data when a quota prevents a marker key but allows epoch rotation", async () => {
  records.set(scope, persisted());
  const firstClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await cold.bindActionQueryCache(firstClient, scope);
  expect(firstClient.getQueryData(queryKey)).toEqual(oldData);

  localStorageMarkerWriteFails = true;
  rejectNextDelete = true;
  await expect(
    firstClient.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(records.has(scope)).toBe(true);
  expect(durableValues.get(epochKey)).not.toBe(initialEpoch);

  const coldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  const readsBefore = events.filter((event) => event === `get:${scope}`).length;
  await cold.bindActionQueryCache(coldClient, scope);
  expect(coldClient.getQueryData(queryKey)).toBeUndefined();
  expect(events.filter((event) => event === `get:${scope}`).length).toBe(
    readsBefore + 1,
  );
  expect(records.has(scope)).toBe(false);
});

it("keeps a newer clear intent when an older clear finishes", async () => {
  const intentKey = `${markerPrefix}shared`;
  durableValues.set(intentKey, "intent-before-clear");
  const clear = addClearGate(1);
  const clearing = first.clearActionQueryCache();
  await clear.started;

  durableValues.set(intentKey, "intent-after-clear-started");
  clear.release();
  await clearing;

  expect(durableValues.get(intentKey)).toBe("intent-after-clear-started");
  expect(pendingIntentKeys()).toContain(intentKey);
});

it("does not let an old-epoch denial invalidate a newer same-scope record", async () => {
  records.set(scope, persisted());
  const oldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await first.bindActionQueryCache(oldClient, scope);
  expect(oldClient.getQueryData(queryKey)).toEqual(oldData);

  // Model another tab completing a clear and then saving a fresh record for
  // the same user scope under the advanced epoch.
  records.clear();
  durableValues.set(epochKey, peerEpoch);
  const freshData = { secretLabel: "new epoch result" };
  records.set(scope, persisted(freshData, peerEpoch));

  await expect(
    oldClient.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(durableValues.get(epochKey)).toBe(peerEpoch);
  expect(pendingIntentKeys()).toEqual([]);
  expect(records.get(scope)?.buster).toBe(`action-query-cache-v1:${peerEpoch}`);
  const freshClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await cold.bindActionQueryCache(freshClient, scope);
  expect(freshClient.getQueryData(queryKey)).toEqual(freshData);
});

it("retains clear protection when a same-epoch pending intent already exists", async () => {
  records.set(scope, persisted());
  const oldClient = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });
  await first.bindActionQueryCache(oldClient, scope);
  expect(oldClient.getQueryData(queryKey)).toEqual(oldData);

  const pendingKey = `${markerPrefix}peer-pending`;
  durableValues.set(pendingKey, "peer-pending");
  await expect(
    oldClient.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect.poll(() => events.includes(`del:${scope}`)).toBe(true);

  expect(durableValues.get(epochKey)).not.toBe(initialEpoch);
  expect(pendingIntentKeys()).toContain(pendingKey);
  expect(records.has(scope)).toBe(false);
});

it("does not overwrite a newer epoch when a probe races with another tab clear", async () => {
  records.set(scope, persisted());
  interleaveClearBeforeEpochProbeWrite = true;
  const client = new QueryClientCtor({
    defaultOptions: { queries: { retry: false } },
  });

  await cold.bindActionQueryCache(client, scope);

  expect(interleavedClearCompleted).toBe(true);
  expect(events).toContain("tab-b:clear-complete");
  expect(durableValues.get(epochKey)).toBe(concurrentEpoch);
  expect(events).not.toContain(`get:${scope}`);
  expect(client.getQueryData(queryKey)).toBeUndefined();
  expect(records.has(scope)).toBe(false);
  expect(
    [...durableValues.keys()].filter((key) => key.includes("probe")),
  ).toEqual([]);
});
