import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { expect, it } from "vitest";

import {
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
} from "./action-query-cache.js";
import { cacheBuster } from "./action-query-cache.test-fixtures.js";
import { isBrowserPersistableActionQuery } from "./use-action.js";

function persistedRecord(
  queryKey: readonly unknown[],
  data: unknown,
): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, data, { updatedAt: Date.now() - 100 });
  return {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
}

function configureStorage(initial: Map<string, PersistedClient>) {
  const records = new Map(initial);
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
  return records;
}

it("does not carry scope A's restored marker into a same-key local query in scope B", async () => {
  const scopeA = `marker-a-${crypto.randomUUID()}`;
  const scopeB = `marker-b-${crypto.randomUUID()}`;
  const queryKey = [
    "action",
    "list-design-templates",
    {
      resourceId: crypto.randomUUID(),
    },
  ] as const;
  configureStorage(
    new Map([[scopeA, persistedRecord(queryKey, { title: "scope A" })]]),
  );
  const clientA = new QueryClient();
  const clientB = new QueryClient();

  try {
    await bindActionQueryCache(clientA, scopeA);
    const restoredA = clientA.getQueryCache().find({ queryKey });
    expect(restoredA?.state.data).toEqual({ title: "scope A" });
    expect(isBrowserPersistableActionQuery(restoredA!)).toBe(true);

    await bindActionQueryCache(clientB, scopeB);
    clientB.setQueryData(queryKey, { title: "scope B local data" });
    const localB = clientB.getQueryCache().find({ queryKey });
    expect(localB?.state.status).toBe("success");
    expect(isBrowserPersistableActionQuery(localB!)).toBe(false);
    expect(
      dehydrate(clientB, {
        shouldDehydrateQuery: isBrowserPersistableActionQuery,
      }).queries.map((query) => query.queryHash),
    ).not.toContain(localB!.queryHash);
  } finally {
    clientA.clear();
    clientB.clear();
    await clearActionQueryCache();
  }
});

it("does not reauthorize a local replacement after a restored query is revoked", async () => {
  const scope = `marker-revoked-${crypto.randomUUID()}`;
  const queryKey = [
    "action",
    "get-private-data",
    {
      resourceId: crypto.randomUUID(),
    },
  ] as const;
  const records = configureStorage(
    new Map([
      [scope, persistedRecord(queryKey, { value: "old allowed data" })],
    ]),
  );
  const client = new QueryClient();

  try {
    await bindActionQueryCache(client, scope);
    const query = client.getQueryCache().find({ queryKey });
    expect(query?.state.data).toEqual({ value: "old allowed data" });
    expect(isBrowserPersistableActionQuery(query!)).toBe(true);

    await expect(
      client.fetchQuery({
        queryKey,
        retry: false,
        queryFn: async () => {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect.poll(() => records.has(scope)).toBe(false);
    expect(query?.state.status).toBe("error");
    expect(isBrowserPersistableActionQuery(query!)).toBe(false);

    client.setQueryData(queryKey, { value: "local replacement after revoke" });
    expect(query?.state.status).toBe("success");
    expect(isBrowserPersistableActionQuery(query!)).toBe(false);
    expect(
      dehydrate(client, {
        shouldDehydrateQuery: isBrowserPersistableActionQuery,
      }).queries.map((entry) => entry.queryHash),
    ).not.toContain(query!.queryHash);
  } finally {
    client.clear();
    await clearActionQueryCache();
  }
});
