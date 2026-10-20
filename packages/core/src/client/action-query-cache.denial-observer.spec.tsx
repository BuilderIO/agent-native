import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

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
import {
  isBrowserPersistableActionQuery,
  useActionQuery,
} from "./use-action.js";

type Payload = { value: string };
type Snapshot = { data: Payload | undefined; status: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(status: number, payload: unknown, allow = false): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(allow ? { "X-Agent-Native-Browser-Persist": "allow" } : {}),
    },
  });
}

function cacheRecord(
  queryKey: readonly unknown[],
  data: Payload,
): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(queryKey, data, { updatedAt: Date.now() - 100 });
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  source.clear();
  return record;
}

function installStorage(initial: Map<string, PersistedClient>) {
  const records = new Map(initial);
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);
  return records;
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

function Probe({
  keyScope,
  onSnapshot,
}: {
  keyScope: string;
  onSnapshot: (snapshot: Snapshot) => void;
}) {
  const query = useActionQuery<Payload>(
    "get-private-data" as never,
    undefined,
    {
      queryKeyScope: [keyScope],
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
  onSnapshot({ data: query.data, status: query.status });
  return (
    <output data-query-status={query.status}>
      {query.data?.value ?? "empty"}
    </output>
  );
}

async function mount(
  client: QueryClient,
  keyScope: string,
  onSnapshot: (snapshot: Snapshot) => void,
): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe keyScope={keyScope} onSnapshot={onSnapshot} />
      </QueryClientProvider>,
    );
  });
  return container;
}

async function cleanup() {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
    entry.client.clear();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(cleanup);

it.each([401, 403, 404])(
  "does not restore same-key data after a mounted action was denied before the first bind (%s)",
  async (status) => {
    const scope = `prebind-denial-${status}-${crypto.randomUUID()}`;
    const keyScope = crypto.randomUUID();
    const queryKey = [
      "action",
      "get-private-data",
      undefined,
      keyScope,
    ] as const;
    const stored = cacheRecord(queryKey, { value: "old persisted result" });
    const records = installStorage(new Map([[scope, stored]]));
    const fetchStarted = deferred<void>();
    const fetchReply = deferred<Response>();
    const denialObserved = deferred<void>();
    const fetchMock = vi.fn(() => {
      fetchStarted.resolve();
      return fetchReply.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    let snapshot: Snapshot = { data: undefined, status: "pending" };
    await mount(client, keyScope, (next) => {
      snapshot = next;
      if (next.status === "error") denialObserved.resolve();
    });

    await fetchStarted.promise;
    await act(async () => {
      fetchReply.resolve(response(status, { error: "access denied" }));
      await denialObserved.promise;
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const query = client.getQueryCache().find({ queryKey });
    expect(query?.state.status).toBe("error");
    expect(query?.state.data).toBeUndefined();
    const deniedError = query?.state.error;

    await act(async () => {
      await bindActionQueryCache(client, scope);
    });

    await expect.poll(() => records.has(scope)).toBe(false);
    expect.soft(snapshot.status).toBe("error");
    expect.soft(snapshot.data).toBeUndefined();
    expect.soft(query?.state.status).toBe("error");
    expect.soft(query?.state.data).toBeUndefined();
    expect.soft(query?.state.error).toBe(deniedError);
    expect.soft(isBrowserPersistableActionQuery(query!)).toBe(false);
    expect
      .soft(
        records
          .get(scope)
          ?.clientState.queries.some(
            (entry) => entry.queryHash === query!.queryHash,
          ) ?? false,
      )
      .toBe(false);

    let remountedSnapshot: Snapshot = { data: undefined, status: "pending" };
    const remountedContainer = await mount(client, keyScope, (next) => {
      remountedSnapshot = next;
    });
    expect.soft(remountedSnapshot.status).not.toBe("success");
    expect.soft(remountedSnapshot.data).toBeUndefined();
    expect.soft(remountedContainer.textContent).toBe("empty");
    expect
      .soft(remountedContainer.querySelector("output")?.dataset.queryStatus)
      .not.toBe("success");
  },
);

it("does not revoke persisted action results after a non-action query is denied", async () => {
  const scope = `non-action-denial-${crypto.randomUUID()}`;
  const keyScope = crypto.randomUUID();
  const actionQueryKey = [
    "action",
    "get-private-data",
    undefined,
    keyScope,
  ] as const;
  const stored = cacheRecord(actionQueryKey, {
    value: "allowed action result",
  });
  const records = new Map([[scope, stored]]);
  const del = vi.fn(async (key: string) => {
    records.delete(key);
  });
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del,
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);
  const client = new QueryClient();
  await bindActionQueryCache(client, scope);

  await expect(
    client.fetchQuery({
      queryKey: ["profile", "current-user"],
      queryFn: async () => {
        throw Object.assign(new Error("profile access denied"), {
          status: 403,
        });
      },
      retry: false,
    }),
  ).rejects.toMatchObject({ status: 403 });

  expect(client.getQueryData(actionQueryKey)).toEqual({
    value: "allowed action result",
  });
  expect(records.has(scope)).toBe(true);
  const actionQueryHash = client.getQueryCache().find({
    queryKey: actionQueryKey,
  })?.queryHash;
  expect(
    records.get(scope)?.clientState.queries.map((query) => query.queryHash),
  ).toContain(actionQueryHash);
  expect(del).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 503])(
  "checks mounted observer data after a hydrated query refetch fails with %s",
  async (status) => {
    const scope = `mounted-refetch-${status}-${crypto.randomUUID()}`;
    const keyScope = crypto.randomUUID();
    const queryKey = [
      "action",
      "get-private-data",
      undefined,
      keyScope,
    ] as const;
    const oldData = { value: "last allowed result" };
    const records = installStorage(
      new Map([[scope, cacheRecord(queryKey, oldData)]]),
    );
    const fetchMock = vi.fn(async () =>
      response(status, { error: `response ${status}` }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    await bindActionQueryCache(client, scope);
    let snapshot: Snapshot = { data: undefined, status: "pending" };
    const container = await mount(client, keyScope, (next) => {
      snapshot = next;
    });

    expect(snapshot).toEqual({ data: oldData, status: "success" });
    const query = client.getQueryCache().find({ queryKey });
    expect(query?.state.status).toBe("success");
    expect(query?.state.data).toEqual(oldData);
    expect(isBrowserPersistableActionQuery(query!)).toBe(true);

    await act(async () => {
      await client.refetchQueries({ queryKey, exact: true });
    });

    await expect.poll(() => snapshot.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(query?.state.status).toBe("error");
    expect((query?.state.error as { status?: number } | null)?.status).toBe(
      status,
    );
    if (status === 503) {
      expect(query?.state.data).toEqual(oldData);
      expect(snapshot).toEqual({ data: oldData, status: "error" });
      expect(container.textContent).toBe(oldData.value);
      expect(container.querySelector("output")?.dataset.queryStatus).toBe(
        "error",
      );
      expect(records.has(scope)).toBe(true);
    } else {
      expect(query?.state.data).toBeUndefined();
      expect(snapshot).toEqual({ data: undefined, status: "error" });
      expect(container.textContent).toBe("empty");
      expect(container.querySelector("output")?.dataset.queryStatus).toBe(
        "error",
      );
      await expect.poll(() => records.has(scope)).toBe(false);
    }
  },
);
