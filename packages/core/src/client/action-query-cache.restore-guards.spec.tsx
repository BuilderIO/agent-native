import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { expect, it } from "vitest";

import {
  bindActionQueryCache,
  setActionQueryCacheStorage,
} from "./action-query-cache.js";
// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";
import { isBrowserPersistableActionQuery } from "./use-action.js";

function persistedFor(
  queryKey: readonly unknown[],
  options: {
    buster?: string;
    timestamp?: number;
    dataUpdatedAt?: number;
    status?: "success" | "error";
  } = {},
): PersistedClient {
  const client = new QueryClient();
  client.setQueryData(
    queryKey,
    { private: "cached" },
    {
      updatedAt: options.dataUpdatedAt,
    },
  );
  const state = dehydrate(client, { shouldDehydrateQuery: () => true });
  if (options.status === "error") {
    const first = state.queries[0];
    if (!first) throw new Error("expected a dehydrated query");
    first.state = {
      ...first.state,
      status: "error",
      error: { status: 403 },
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: 1,
      fetchFailureReason: { status: 403 },
    };
  }
  return {
    timestamp: options.timestamp ?? Date.now(),
    buster: cacheBuster(options.buster),
    clientState: state,
  };
}

async function restore(record: PersistedClient, scope: string) {
  const records = new Map([[scope, record]]);
  setActionQueryCacheStorage({
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
  await bindActionQueryCache(client, scope);
  return { client, records };
}

it("rejects an expired record and a buster mismatch without restoring eligibility", async () => {
  const expiredScope = `expired-${crypto.randomUUID()}`;
  const expired = await restore(
    persistedFor(["action", "list-designs"], {
      timestamp: Date.now() - 2 * 60 * 60 * 1000,
    }),
    expiredScope,
  );
  expect(expired.client.getQueryCache().getAll()).toEqual([]);
  expect(expired.records.has(expiredScope)).toBe(false);

  const bustedScope = `busted-${crypto.randomUUID()}`;
  const busted = await restore(
    persistedFor(["action", "list-designs"], { buster: "old-schema" }),
    bustedScope,
  );
  expect(busted.client.getQueryCache().getAll()).toEqual([]);
  expect(busted.records.has(bustedScope)).toBe(false);
});

it("does not mark per-query expired or non-action/error states eligible", async () => {
  const staleScope = `stale-${crypto.randomUUID()}`;
  const staleKey = ["action", "list-designs", staleScope] as const;
  const stale = await restore(
    persistedFor(staleKey, { dataUpdatedAt: Date.now() - 2 * 60 * 60 * 1000 }),
    staleScope,
  );
  expect(
    stale.client.getQueryCache().find({ queryKey: staleKey }),
  ).toBeUndefined();

  const unrelatedScope = `unrelated-${crypto.randomUUID()}`;
  const unrelatedKey = ["unrelated", "list-designs", unrelatedScope] as const;
  const unrelated = await restore(persistedFor(unrelatedKey), unrelatedScope);
  const unrelatedQuery = unrelated.client
    .getQueryCache()
    .find({ queryKey: unrelatedKey });
  expect(unrelatedQuery?.state.status).toBe("success");
  expect(isBrowserPersistableActionQuery(unrelatedQuery!)).toBe(false);

  const errorScope = `error-${crypto.randomUUID()}`;
  const errorKey = ["action", "list-designs", errorScope] as const;
  const error = await restore(
    persistedFor(errorKey, { status: "error" }),
    errorScope,
  );
  const errorQuery = error.client.getQueryCache().find({ queryKey: errorKey });
  expect(errorQuery?.state.status).toBe("error");
  expect(isBrowserPersistableActionQuery(errorQuery!)).toBe(false);
});

it("does not reauthorize existing local state when hydration skips an equal timestamp", async () => {
  const scope = `equal-time-${crypto.randomUUID()}`;
  const queryKey = ["action", "list-designs", scope] as const;
  const sharedTimestamp = Date.now() - 10;
  const persisted = persistedFor(queryKey, { dataUpdatedAt: sharedTimestamp });
  const records = new Map([[scope, persisted]]);
  setActionQueryCacheStorage({
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
  client.setQueryData(
    queryKey,
    { private: "local-unallowlisted" },
    {
      updatedAt: sharedTimestamp,
    },
  );
  await bindActionQueryCache(client, scope, { trustPrebindResults: true });

  const query = client.getQueryCache().find({ queryKey });
  expect(query?.state.data).toEqual({ private: "local-unallowlisted" });
  expect(isBrowserPersistableActionQuery(query!)).toBe(false);
});

it("does not let a closed old-scope restore authorize its query after a switch", async () => {
  const scopeA = `scope-a-${crypto.randomUUID()}`;
  const scopeB = `scope-b-${crypto.randomUUID()}`;
  const queryKey = ["action", "list-designs", "same-hash"] as const;
  const recordA = persistedFor(queryKey);
  let releaseA!: (record: PersistedClient) => void;
  const records = new Map([[scopeA, recordA]]);
  setActionQueryCacheStorage({
    get: (key) =>
      key === scopeA
        ? new Promise<PersistedClient>((resolve) => {
            releaseA = resolve;
          })
        : Promise.resolve(records.get(key)),
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
  const restoringA = bindActionQueryCache(client, scopeA);
  await expect.poll(() => Boolean(releaseA)).toBe(true);
  await bindActionQueryCache(client, scopeB);
  releaseA(recordA);
  await restoringA;

  expect(client.getQueryCache().find({ queryKey })).toBeUndefined();
});
