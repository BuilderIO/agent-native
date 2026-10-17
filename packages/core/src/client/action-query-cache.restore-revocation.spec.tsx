import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { expect, it } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([401, 403, 404])(
  "does not restore or reauthorize a record revoked with %i while its read is pending",
  async (status) => {
    const action = await import("./use-action.js");
    const cache = await import("./action-query-cache.js");
    const scope = `revoked-pending-read-${crypto.randomUUID()}`;
    const queryKey = ["action", "get-private-data", scope] as const;
    const updatedAt = Date.now() - 100;
    const source = new QueryClient();
    source.setQueryData(
      queryKey,
      { value: "old-allowed-result" },
      { updatedAt },
    );
    const record: PersistedClient = {
      timestamp: Date.now(),
      buster: cacheBuster(),
      clientState: dehydrate(source),
    };
    const readStarted = deferred<void>();
    const diskRead = deferred<PersistedClient | undefined>();
    const deleted: string[] = [];
    cache.setActionQueryCacheStorage({
      get: async () => {
        readStarted.resolve();
        return diskRead.promise;
      },
      set: async () => {},
      del: async (key) => {
        deleted.push(key);
      },
      keys: async () => [scope],
      clear: async () => {},
    });
    const client = new QueryClient();

    try {
      const binding = cache.bindActionQueryCache(client, scope);
      await readStarted.promise;

      await expect(
        client.fetchQuery({
          queryKey,
          retry: false,
          queryFn: async () => {
            throw Object.assign(new Error("forbidden"), { status });
          },
        }),
      ).rejects.toMatchObject({ status });
      expect(deleted).toContain(scope);

      diskRead.resolve(record);
      await binding;

      const query = client.getQueryCache().find({ queryKey });
      expect(query?.state.data).toBeUndefined();
      expect(action.isBrowserPersistableActionQuery(query!)).toBe(false);
    } finally {
      source.clear();
      await cache.clearActionQueryCache();
    }
  },
);

it.each([401, 403, 404])(
  "clears restore eligibility when a hydrated result is revoked with %i",
  async (status) => {
    const action = await import("./use-action.js");
    const cache = await import("./action-query-cache.js");
    const scope = `revoked-after-restore-${crypto.randomUUID()}`;
    const queryKey = ["action", "get-private-data", scope] as const;
    const updatedAt = Date.now() - 100;
    const source = new QueryClient();
    source.setQueryData(
      queryKey,
      { value: "old-allowed-result" },
      { updatedAt },
    );
    const record: PersistedClient = {
      timestamp: Date.now(),
      buster: cacheBuster(),
      clientState: dehydrate(source),
    };
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
    const client = new QueryClient();

    try {
      await cache.bindActionQueryCache(client, scope);
      const query = client.getQueryCache().find({ queryKey });
      expect(query?.state.data).toEqual({ value: "old-allowed-result" });
      expect(action.isBrowserPersistableActionQuery(query!)).toBe(true);

      await expect(
        client.fetchQuery({
          queryKey,
          retry: false,
          queryFn: async () => {
            throw Object.assign(new Error("forbidden"), { status });
          },
        }),
      ).rejects.toMatchObject({ status });

      expect(records.has(scope)).toBe(false);
      expect(action.isBrowserPersistableActionQuery(query!)).toBe(false);
      const snapshot = dehydrate(client, {
        shouldDehydrateQuery: action.isBrowserPersistableActionQuery,
      });
      expect(snapshot.queries.map((entry) => entry.queryHash)).not.toContain(
        query!.queryHash,
      );
    } finally {
      source.clear();
      await cache.clearActionQueryCache();
    }
  },
);
