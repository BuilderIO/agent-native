import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does not authorize local success when a fetch-state update races equal-time restore", async () => {
  const action = await import("./use-action.js");
  const cache = await import("./action-query-cache.js");
  const scope = `equal-time-state-race-${crypto.randomUUID()}`;
  const queryKey = ["action", "list-designs", undefined, scope] as const;
  const updatedAt = Date.now();
  const persistedSource = new QueryClient();
  persistedSource.setQueryData(
    queryKey,
    { title: "allowed-from-disk" },
    { updatedAt },
  );
  const sourceQuery = persistedSource.getQueryCache().find({ queryKey });
  expect(sourceQuery).toBeDefined();
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(persistedSource),
  };

  const readStarted = deferred<void>();
  const diskRead = deferred<PersistedClient | undefined>();
  const storage = {
    get: vi.fn(async () => {
      readStarted.resolve();
      return diskRead.promise;
    }),
    set: async () => {},
    del: async () => {},
    keys: async () => [scope],
    clear: async () => {},
  };
  cache.setActionQueryCacheStorage(storage);

  const client = new QueryClient();
  client.setQueryData(queryKey, { title: "local-private-deny" }, { updatedAt });
  const localQuery = client.getQueryCache().find({ queryKey });
  expect(localQuery?.state.status).toBe("success");
  expect(localQuery?.state.dataUpdatedAt).toBe(updatedAt);

  try {
    const binding = cache.bindActionQueryCache(client, scope, {
      trustPrebindResults: true,
    });
    await readStarted.promise;
    const stateBeforeLocalTransition = localQuery!.state;
    client.setQueryData(
      queryKey,
      { title: "local-private-deny-updated" },
      { updatedAt },
    );
    localQuery!.setState({ fetchStatus: "fetching" });
    expect(localQuery!.state).not.toBe(stateBeforeLocalTransition);
    expect(localQuery!.state.dataUpdatedAt).toBe(updatedAt);

    diskRead.resolve(record);
    await binding;

    // TanStack skips hydrate for equal dataUpdatedAt. The local private value
    // remains, even though its state object changed during the pending read.
    expect(localQuery!.state.data).toEqual({
      title: "local-private-deny-updated",
    });
    expect(localQuery!.state.fetchStatus).toBe("fetching");
    expect(sourceQuery!.state.dataUpdatedAt).toBe(
      localQuery!.state.dataUpdatedAt,
    );

    // TanStack skips equal-timestamp hydration, so local-only state must not
    // become eligible merely because it changed while the disk read was open.
    expect(action.isBrowserPersistableActionQuery(localQuery!)).toBe(false);
    const nextSnapshot = dehydrate(client, {
      shouldDehydrateQuery: action.isBrowserPersistableActionQuery,
      shouldDehydrateMutation: () => false,
    });
    expect(nextSnapshot.queries.map((query) => query.queryHash)).not.toContain(
      localQuery!.queryHash,
    );
  } finally {
    await cache.clearActionQueryCache();
    persistedSource.clear();
  }
});
