import { vi } from "vitest";

import { cacheBuster } from "./action-query-cache.test-fixtures.js";
vi.mock("./use-session.js", () => ({
  useSession: () => ({ session: null, status: "unavailable", isLoading: true }),
  isSessionFromFirstRead: () => false,
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";

import * as api from "./action-query-cache.js";
import type { ActionQueryCacheStorage } from "./action-query-cache.js";

type CacheApi = {
  bindActionQueryCache: (client: QueryClient, scope: string) => Promise<void>;
  clearActionQueryCache: () => Promise<void>;
  setActionQueryCacheStorage: (
    storage: ActionQueryCacheStorage | undefined,
  ) => void;
};
const queryKey = [
  "action",
  "scope-provenance-probe",
  { id: "same-key" },
] as const;
const clients: QueryClient[] = [];

function persisted(value: string): PersistedClient {
  const client = new QueryClient();
  client.setQueryData(queryKey, { value });
  return {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(client),
  };
}

function memoryStorage(initial = new Map<string, PersistedClient>()) {
  const records = initial;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => {
      records.clear();
    },
  };
  return { records, storage };
}

function newClient() {
  const client = new QueryClient();
  clients.push(client);
  return client;
}

async function recordAccessDenied(client: QueryClient) {
  await expect(
    client.fetchQuery({
      queryKey,
      retry: false,
      queryFn: async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.clear();
  await activeApi?.clearActionQueryCache();
  activeApi?.setActionQueryCacheStorage(undefined);
});

let activeApi: CacheApi | undefined;
export function registerScopeProvenanceCases(label: string, api: CacheApi) {
  activeApi = api;
  it(`${label}: discards B's record when a custom query has no denial provenance`, async () => {
    const scopeA = `scope-a-${crypto.randomUUID()}`;
    const scopeB = `scope-b-${crypto.randomUUID()}`;
    const { records, storage } = memoryStorage();
    api.setActionQueryCacheStorage(storage);
    const client = newClient();
    await api.bindActionQueryCache(client, scopeA);
    await recordAccessDenied(client);
    expect(records.has(scopeA)).toBe(false);

    records.set(scopeB, persisted("B-only cached result"));
    await api.bindActionQueryCache(client, scopeB);

    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(records.has(scopeB)).toBe(false);
  });

  it(`${label}: an unknown pre-bind denial still clears the next scope`, async () => {
    const scope = `unknown-${crypto.randomUUID()}`;
    const { records, storage } = memoryStorage(
      new Map([[scope, persisted("must be discarded")]]),
    );
    api.setActionQueryCacheStorage(storage);
    const client = newClient();
    await recordAccessDenied(client);

    await api.bindActionQueryCache(client, scope);

    expect(records.has(scope)).toBe(false);
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });

  it(`${label}: a same-scope denial still clears that scope`, async () => {
    const scope = `same-${crypto.randomUUID()}`;
    const { records, storage } = memoryStorage();
    api.setActionQueryCacheStorage(storage);
    const client = newClient();
    await api.bindActionQueryCache(client, scope);
    await recordAccessDenied(client);
    records.set(scope, persisted("must be discarded"));

    await api.bindActionQueryCache(client, scope);

    expect(records.has(scope)).toBe(false);
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
}

registerScopeProvenanceCases("scope provenance", api);
