import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

function persistedFor(
  queryKey: readonly unknown[],
  data: unknown,
): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, data);
  return {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("preserves the QueryClient custom deserializer and only accepts its result", async () => {
  const action = await import("./use-action.js");
  const cache = await import("./action-query-cache.js");
  const scope = `custom-deserializer-${crypto.randomUUID()}`;
  const queryKey = ["action", "get-release-date", scope] as const;
  const record = persistedFor(queryKey, { encodedDate: "2026-10-11" });
  const records = new Map([[scope, record]]);
  cache.setActionQueryCacheStorage({
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  });

  const deserializeData = vi.fn((data: unknown) => {
    if (
      !data ||
      typeof data !== "object" ||
      !("encodedDate" in data) ||
      typeof data.encodedDate !== "string"
    ) {
      throw new Error("unexpected persisted data");
    }
    return new Date(data.encodedDate);
  });
  const hydratedQueryDefaults = { gcTime: 12_345 };
  const client = new QueryClient({
    defaultOptions: {
      hydrate: {
        deserializeData,
        queries: hydratedQueryDefaults,
      },
    },
  });

  try {
    await cache.bindActionQueryCache(client, scope);

    const query = client.getQueryCache().find({ queryKey });
    expect(query?.state.data).toEqual(new Date("2026-10-11"));
    expect(query?.state.data).toBeInstanceOf(Date);
    expect(query?.options.gcTime).toBe(hydratedQueryDefaults.gcTime);
    expect(deserializeData).toHaveBeenCalledOnce();
    expect(action.isBrowserPersistableActionQuery(query!)).toBe(true);
  } finally {
    await cache.clearActionQueryCache();
  }
});

it("keeps data mapping aligned across undefined and pending queries", async () => {
  const action = await import("./use-action.js");
  const cache = await import("./action-query-cache.js");
  const scope = `ordered-restore-${crypto.randomUUID()}`;
  const undefinedKey = ["action", "undefined-data", scope] as const;
  const pendingKey = ["action", "pending-data", scope] as const;
  const firstDataKey = ["action", "first-data", scope] as const;
  const secondDataKey = ["action", "second-data", scope] as const;
  const source = new QueryClient();
  source.setQueryData(undefinedKey, { removed: true });
  source.setQueryData(firstDataKey, { value: "first" });
  source.setQueryData(pendingKey, { removed: true });
  source.setQueryData(secondDataKey, { value: "second" });
  const clientState = dehydrate(source);
  const undefinedEntry = clientState.queries.find(
    (query) => query.queryKey[1] === "undefined-data",
  );
  const pendingEntry = clientState.queries.find(
    (query) => query.queryKey[1] === "pending-data",
  );
  if (!undefinedEntry || !pendingEntry) {
    throw new Error("expected ordered no-data query entries");
  }
  undefinedEntry.state = {
    ...undefinedEntry.state,
    data: undefined,
  };
  pendingEntry.state = {
    ...pendingEntry.state,
    data: undefined,
    status: "pending",
    fetchStatus: "fetching",
  };
  pendingEntry.promise = new Promise(() => {});

  const scopeRecord: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState,
  };
  const records = new Map([[scope, scopeRecord]]);
  cache.setActionQueryCacheStorage({
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  });
  const deserializeData = vi.fn((data: unknown) => data);
  const restored = new QueryClient({
    defaultOptions: { hydrate: { deserializeData } },
  });

  try {
    await cache.bindActionQueryCache(restored, scope);

    const undefinedQuery = restored
      .getQueryCache()
      .find({ queryKey: undefinedKey });
    const pendingQuery = restored
      .getQueryCache()
      .find({ queryKey: pendingKey });
    const firstDataQuery = restored
      .getQueryCache()
      .find({ queryKey: firstDataKey });
    const secondDataQuery = restored
      .getQueryCache()
      .find({ queryKey: secondDataKey });
    expect(undefinedQuery?.state.status).toBe("success");
    expect(undefinedQuery?.state.data).toBeUndefined();
    expect(pendingQuery?.state.status).toBe("pending");
    expect(firstDataQuery?.state.data).toEqual({ value: "first" });
    expect(secondDataQuery?.state.data).toEqual({ value: "second" });
    expect(deserializeData).toHaveBeenCalledTimes(2);
    expect(action.isBrowserPersistableActionQuery(undefinedQuery!)).toBe(false);
    expect(action.isBrowserPersistableActionQuery(pendingQuery!)).toBe(false);
    expect(action.isBrowserPersistableActionQuery(firstDataQuery!)).toBe(true);
    expect(action.isBrowserPersistableActionQuery(secondDataQuery!)).toBe(true);
  } finally {
    source.clear();
    await cache.clearActionQueryCache();
  }
});

it("accepts a valid restore after the UI restore wait has timed out", async () => {
  const action = await import("./use-action.js");
  const cache = await import("./action-query-cache.js");
  const scope = `late-restore-${crypto.randomUUID()}`;
  const queryKey = ["action", "list-designs", scope] as const;
  const record = persistedFor(queryKey, {
    designs: [{ title: "late result" }],
  });
  const diskRead = deferred<PersistedClient | undefined>();
  const readStarted = deferred<void>();
  const records = new Map<string, PersistedClient>();
  cache.setActionQueryCacheStorage({
    get: async () => {
      readStarted.resolve();
      return diskRead.promise;
    },
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [scope],
    clear: async () => records.clear(),
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new QueryClient();

  try {
    const binding = cache.bindActionQueryCache(client, scope);
    await readStarted.promise;
    await binding;

    expect(client.getQueryCache().find({ queryKey })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Cached action results did not restore in time; loading without them.",
    );

    diskRead.resolve(record);
    await expect
      .poll(
        () => {
          const query = client.getQueryCache().find({ queryKey });
          return query && action.isBrowserPersistableActionQuery(query);
        },
        { timeout: 1_000, interval: 10 },
      )
      .toBe(true);

    client.setQueryData(["write-trigger", scope], { ok: true });
    await expect
      .poll(() => records.get(scope)?.clientState.queries, {
        timeout: 3_000,
        interval: 25,
      })
      .toContainEqual(
        expect.objectContaining({
          queryHash: client.getQueryCache().find({ queryKey })?.queryHash,
        }),
      );
  } finally {
    warn.mockRestore();
    await cache.clearActionQueryCache();
  }
});

it("does not accept a local query added while the disk restore is pending", async () => {
  const action = await import("./use-action.js");
  const cache = await import("./action-query-cache.js");
  const scope = `local-add-race-${crypto.randomUUID()}`;
  const restoredKey = ["action", "restored", scope] as const;
  const localKey = ["action", "local-only", scope] as const;
  const updatedAt = Date.now() - 5;
  const record = persistedFor(restoredKey, { title: "from disk" });
  const readStarted = deferred<void>();
  const diskRead = deferred<PersistedClient | undefined>();
  cache.setActionQueryCacheStorage({
    get: async () => {
      readStarted.resolve();
      return diskRead.promise;
    },
    set: async () => {},
    del: async () => {},
    keys: async () => [scope],
    clear: async () => {},
  });
  const client = new QueryClient();

  try {
    const binding = cache.bindActionQueryCache(client, scope);
    await readStarted.promise;
    client.setQueryData(localKey, { title: "local-only" }, { updatedAt });
    diskRead.resolve(record);
    await binding;

    const local = client.getQueryCache().find({ queryKey: localKey });
    const restored = client.getQueryCache().find({ queryKey: restoredKey });
    expect(local?.state.status).toBe("success");
    expect(action.isBrowserPersistableActionQuery(local!)).toBe(false);
    expect(action.isBrowserPersistableActionQuery(restored!)).toBe(true);
    const snapshot = dehydrate(client, {
      shouldDehydrateQuery: action.isBrowserPersistableActionQuery,
    });
    expect(snapshot.queries.map((query) => query.queryHash)).not.toContain(
      local!.queryHash,
    );
    expect(snapshot.queries.map((query) => query.queryHash)).toContain(
      restored!.queryHash,
    );
  } finally {
    await cache.clearActionQueryCache();
  }
});

it("does not accept a late restore after the binding generation changes", async () => {
  const action = await import("./use-action.js");
  const cache = await import("./action-query-cache.js");
  const scopeA = `late-old-scope-${crypto.randomUUID()}`;
  const scopeB = `late-new-scope-${crypto.randomUUID()}`;
  const queryKey = ["action", "list-designs", "shared-query-key"] as const;
  const updatedAt = Date.now() - 10;
  const recordA = persistedFor(queryKey, { title: "old-scope" });
  const diskRead = deferred<PersistedClient | undefined>();
  const readStarted = deferred<void>();
  const readSettled = deferred<void>();
  cache.setActionQueryCacheStorage({
    get: async (key) => {
      if (key !== scopeA) return undefined;
      readStarted.resolve();
      try {
        return await diskRead.promise;
      } finally {
        readSettled.resolve();
      }
    },
    set: async () => {},
    del: async () => {},
    keys: async () => [scopeA, scopeB],
    clear: async () => {},
  });
  const client = new QueryClient();

  try {
    const bindingA = cache.bindActionQueryCache(client, scopeA);
    await readStarted.promise;
    await bindingA;
    expect(client.getQueryCache().find({ queryKey })).toBeUndefined();

    await cache.bindActionQueryCache(client, scopeB);
    client.setQueryData(queryKey, { title: "new-scope-local" }, { updatedAt });
    diskRead.resolve(recordA);
    await readSettled.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const query = client.getQueryCache().find({ queryKey });
    expect(query?.state.data).toEqual({ title: "new-scope-local" });
    expect(action.isBrowserPersistableActionQuery(query!)).toBe(false);
  } finally {
    await cache.clearActionQueryCache();
  }
});
