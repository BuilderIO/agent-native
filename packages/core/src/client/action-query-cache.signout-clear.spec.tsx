import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cacheBuster } from "./action-query-cache.test-fixtures.js";
// @vitest-environment happy-dom
import { useActionQuery } from "./use-action.js";

vi.mock("./use-session.js", () => ({
  useSession: () => ({ session: null, status: "unavailable", isLoading: true }),
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import {
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
type Data = { value: string };

function cacheRecord(
  queryKey: readonly unknown[],
  data: Data,
): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, data, { updatedAt: Date.now() - 50 });
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  source.clear();
  return record;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(status = 200): Response {
  return new Response(
    JSON.stringify(status === 200 ? { value: "fresh" } : { error: "denied" }),
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

function Probe({ scope }: { scope: string }) {
  const query = useActionQuery<Data>("get-private-data" as never, undefined, {
    queryKeyScope: [scope],
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  return <output>{query.data?.value ?? query.status}</output>;
}

const mounted: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

async function mount(client: QueryClient, scope: string): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe scope={scope} />
      </QueryClientProvider>,
    );
  });
}

function delayedWriteStorage(
  options: {
    delayDelete?: boolean;
    failClearCount?: number;
    initialRecords?: Map<string, PersistedClient>;
  } = {},
) {
  const records = new Map(options.initialRecords);
  const events: string[] = [];
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const writeFinished = deferred<void>();
  const deleteStarted = deferred<void>();
  const releaseDelete = deferred<void>();
  const deleteFinished = deferred<void>();
  let delayedFirstWrite = true;
  let delayedFirstDelete = options.delayDelete === true;
  let remainingClearFailures = options.failClearCount ?? 0;
  const storage: ActionQueryCacheStorage = {
    async get(key) {
      events.push(`get:${key}`);
      return records.get(key);
    },
    async set(key, value) {
      events.push(`set:start:${key}`);
      writeStarted.resolve();
      if (delayedFirstWrite) {
        delayedFirstWrite = false;
        await releaseWrite.promise;
      }
      records.set(key, value);
      events.push(`set:end:${key}`);
      writeFinished.resolve();
    },
    async del(key) {
      events.push(`del:start:${key}`);
      if (delayedFirstDelete) {
        delayedFirstDelete = false;
        deleteStarted.resolve();
        await releaseDelete.promise;
      }
      records.delete(key);
      events.push(`del:end:${key}`);
      deleteFinished.resolve();
    },
    async keys() {
      return [...records.keys()];
    },
    async clear() {
      events.push("clear:start");
      if (remainingClearFailures > 0) {
        remainingClearFailures -= 1;
        events.push("clear:failed");
        throw new Error("simulated storage clear failure");
      }
      records.clear();
      events.push("clear:end");
    },
  };
  setActionQueryCacheStorage(storage);
  setActionQueryCacheStorage(storage);
  return {
    records,
    events,
    releaseWrite,
    writeFinished,
    writeStarted,
    releaseDelete,
    deleteFinished,
    deleteStarted,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
    entry.client.clear();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("waits for old writes and deletes before clearing and holds a new bind behind the clear", async () => {
  const scope = `signout-candidate-${crypto.randomUUID()}`;
  const nextScope = `after-signout-${crypto.randomUUID()}`;
  const storage = delayedWriteStorage({ delayDelete: true });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(403))
    .mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient();
  await bindActionQueryCache(client, scope);
  await mount(client, scope);
  const query = client.getQueryCache().find({
    queryKey: ["action", "get-private-data", undefined, scope],
  });
  await expect.poll(() => query?.state.status).toBe("success");
  await storage.writeStarted.promise;

  await act(async () => {
    await client.refetchQueries({ queryKey: query!.queryKey, exact: true });
  });
  expect(query?.state.status).toBe("error");

  const clear = clearActionQueryCache();
  const nextClient = new QueryClient();
  let bindFinished = false;
  const nextBind = bindActionQueryCache(nextClient, nextScope).then(() => {
    bindFinished = true;
  });
  await Promise.resolve();
  expect(bindFinished).toBe(false);
  expect(storage.events.some((event) => event === `get:${nextScope}`)).toBe(
    false,
  );
  expect(storage.events).not.toContain("clear:start");

  storage.releaseWrite.resolve();
  await storage.writeFinished.promise;
  await storage.deleteStarted.promise;
  expect(storage.events).not.toContain("clear:start");
  storage.releaseDelete.resolve();
  await storage.deleteFinished.promise;
  await clear;
  await nextBind;
  expect(storage.records.size).toBe(0);
  const writeEnd = storage.events.indexOf(`set:end:${scope}`);
  const deleteStart = storage.events.indexOf(`del:start:${scope}`);
  const deleteEnd = storage.events.indexOf(`del:end:${scope}`);
  const clearStart = storage.events.indexOf("clear:start");
  const clearEnd = storage.events.indexOf("clear:end");
  const nextRead = storage.events.indexOf(`get:${nextScope}`);
  expect(writeEnd).toBeLessThan(clearStart);
  expect(writeEnd).toBeLessThan(deleteStart);
  expect(deleteStart).toBeLessThan(deleteEnd);
  expect(deleteEnd).toBeLessThan(clearStart);
  expect(clearStart).toBeLessThan(clearEnd);
  expect(clearEnd).toBeLessThan(nextRead);

  await mount(nextClient, nextScope);
  const nextQuery = nextClient.getQueryCache().find({
    queryKey: ["action", "get-private-data", undefined, nextScope],
  });
  await expect.poll(() => nextQuery?.state.status).toBe("success");
  await expect
    .poll(() => storage.records.has(nextScope), { timeout: 2_500 })
    .toBe(true);
});

it("blocks restore after repeated clear failures, then accepts fresh data after clear succeeds", async () => {
  const scope = `signout-retry-${crypto.randomUUID()}`;
  const queryKey = ["action", "get-private-data", undefined, scope] as const;
  const oldData = { value: "signed-out result" };
  const storage = delayedWriteStorage({
    failClearCount: 2,
    initialRecords: new Map([[scope, cacheRecord(queryKey, oldData)]]),
  });
  const client = new QueryClient();

  await expect(clearActionQueryCache()).rejects.toThrow(
    "simulated storage clear failure",
  );
  expect(storage.records.has(scope)).toBe(true);

  await expect(bindActionQueryCache(client, scope)).rejects.toThrow(
    "simulated storage clear failure",
  );
  expect(storage.records.has(scope)).toBe(true);
  expect(storage.events.some((event) => event === `get:${scope}`)).toBe(false);

  await bindActionQueryCache(client, scope);
  expect(client.getQueryData(queryKey)).toBeUndefined();
  expect(storage.records.has(scope)).toBe(false);
  const firstFailedClear = storage.events.indexOf("clear:failed");
  const retryFailedClear = storage.events.indexOf(
    "clear:failed",
    firstFailedClear + 1,
  );
  const successfulClear = storage.events.indexOf("clear:end");
  const retriedClear = storage.events.indexOf(
    "clear:start",
    retryFailedClear + 1,
  );
  const restoredRead = storage.events.indexOf(`get:${scope}`);
  expect(firstFailedClear).toBeGreaterThanOrEqual(0);
  expect(firstFailedClear).toBeLessThan(retryFailedClear);
  expect(retryFailedClear).toBeLessThan(retriedClear);
  expect(retriedClear).toBeLessThan(successfulClear);
  expect(successfulClear).toBeLessThan(restoredRead);

  await mount(client, scope);
  const query = client.getQueryCache().find({ queryKey });
  await expect.poll(() => query?.state.status).toBe("success");
  await storage.writeStarted.promise;
  storage.releaseWrite.resolve();
  await storage.writeFinished.promise;
  expect(client.getQueryData(queryKey)).toEqual({ value: "fresh" });
  await expect
    .poll(() =>
      storage.records
        .get(scope)
        ?.clientState.queries.some(
          (entry) =>
            entry.queryHash === query?.queryHash &&
            (entry.state.data as Data | undefined)?.value === "fresh",
        ),
    )
    .toBe(true);
});
