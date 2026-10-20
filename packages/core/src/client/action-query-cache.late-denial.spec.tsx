import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  dehydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

vi.mock("./use-session.js", () => ({
  useSession: () => ({ session: null, status: "unavailable", isLoading: true }),
  isSessionFromFirstRead: () => false,
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import * as cache from "./action-query-cache.js";
import type { ActionQueryCacheStorage } from "./action-query-cache.js";
import { clientBuildId } from "./build-compatibility.js";
import {
  getAccessDeniedActionQueryBinding,
  useActionQuery,
} from "./use-action.js";

type Payload = { value: string };
type Snapshot = { data: Payload | undefined; status: string };

const USER_A = {
  email: "a@example.test",
  userId: "late-denial-user-a",
  orgId: "org-a",
};
const USER_B = {
  email: "b@example.test",
  userId: "late-denial-user-b",
  orgId: "org-b",
};
const SCOPE_A = cache.actionQueryCacheScope(USER_A, clientBuildId());
const SCOPE_B = cache.actionQueryCacheScope(USER_B, clientBuildId());
const QUERY_A = ["action", "get-private-data", undefined, "request-a"] as const;
const QUERY_B = ["action", "get-private-data", undefined, "active-b"] as const;

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
  const client = new QueryClient();
  client.setQueryData(queryKey, data, { updatedAt: Date.now() - 100 });
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(client),
  };
  client.clear();
  return record;
}

function installStorage(initial: Map<string, PersistedClient>) {
  const records = new Map(initial);
  const deletes: string[] = [];
  let heldScan:
    | {
        started: ReturnType<typeof deferred<void>>;
        release: ReturnType<typeof deferred<void>>;
      }
    | undefined;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      deletes.push(key);
      records.delete(key);
    },
    keys: async () => {
      if (heldScan) {
        const scan = heldScan;
        heldScan = undefined;
        scan.started.resolve();
        await scan.release.promise;
      }
      return [...records.keys()];
    },
    clear: async () => records.clear(),
  };
  cache.setActionQueryCacheStorage(storage);
  return {
    records,
    deletes,
    storage,
    holdNextKeyScan() {
      const scan = { started: deferred<void>(), release: deferred<void>() };
      heldScan = scan;
      return scan;
    },
  };
}

function Probe({
  scope,
  onSnapshot,
}: {
  scope: string;
  onSnapshot: (snapshot: Snapshot) => void;
}) {
  const query = useActionQuery<Payload>(
    "get-private-data" as never,
    undefined,
    {
      queryKeyScope: [scope],
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  );
  onSnapshot({ data: query.data, status: query.status });
  return (
    <output data-query-scope={scope} data-query-status={query.status}>
      {query.data?.value ?? "empty"}
    </output>
  );
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];
const clients: QueryClient[] = [];
const pendingBinds: Promise<void>[] = [];
let releaseHeldScan: (() => void) | undefined;

function newClient() {
  const client = new QueryClient();
  clients.push(client);
  return client;
}

async function mount(
  client: QueryClient,
  scope: string,
  onSnapshot: (snapshot: Snapshot) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe scope={scope} onSnapshot={onSnapshot} />
      </QueryClientProvider>,
    );
  });
  return container;
}

async function cleanup() {
  releaseHeldScan?.();
  releaseHeldScan = undefined;
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  await Promise.all(
    pendingBinds.splice(0).map((pending) => pending.catch(() => {})),
  );
  for (const client of clients.splice(0)) client.clear();
  await cache.clearActionQueryCache().catch(() => {});
  cache.setActionQueryCacheStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(cleanup);

async function runHeldARequestAgainstActiveB() {
  const storage = installStorage(
    new Map([[SCOPE_A, cacheRecord(QUERY_A, { value: "A disk result" })]]),
  );
  const clientA = newClient();
  await act(async () => {
    await cache.bindActionQueryCache(clientA, SCOPE_A);
  });
  expect(storage.records.has(SCOPE_A)).toBe(true);

  const fetchStarted = deferred<void>();
  const fetchReply = deferred<Response>();
  const fetchMock = vi.fn(() => {
    fetchStarted.resolve();
    return fetchReply.promise;
  });
  vi.stubGlobal("fetch", fetchMock);

  const clientB = newClient();
  let aSnapshot: Snapshot = { data: undefined, status: "pending" };
  const aContainer = await mount(clientB, "request-a", (next) => {
    aSnapshot = next;
  });
  await fetchStarted.promise;
  const aQuery = clientB.getQueryCache().find({ queryKey: QUERY_A });
  expect(aQuery?.state.fetchStatus).toBe("fetching");

  storage.records.set(
    SCOPE_B,
    cacheRecord(QUERY_B, { value: "B disk result" }),
  );
  const keyScan = storage.holdNextKeyScan();
  releaseHeldScan = keyScan.release.resolve;
  const bBind = cache.bindActionQueryCache(clientB, SCOPE_B, {
    trustPrebindResults: true,
  });
  pendingBinds.push(bBind);
  await keyScan.started.promise;

  clientB.setQueryData(QUERY_B, { value: "B active result" });
  let bSnapshot: Snapshot = { data: undefined, status: "pending" };
  const bContainer = await mount(clientB, "active-b", (next) => {
    bSnapshot = next;
  });
  expect(bSnapshot).toEqual({
    data: { value: "B active result" },
    status: "success",
  });
  expect(bContainer.textContent).toBe("B active result");

  await act(async () => {
    fetchReply.resolve(response(403, { error: "A is no longer allowed" }));
    await expect.poll(() => aSnapshot.status).toBe("error");
  });
  expect(getAccessDeniedActionQueryBinding(aQuery!)).toBeDefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  return {
    storage,
    clientB,
    aContainer,
    bContainer,
    aSnapshot,
    bSnapshot,
    keyScan,
  };
}

it("a late denial from A revokes A storage without discarding mounted B data", async () => {
  const result = await runHeldARequestAgainstActiveB();
  await expect.poll(() => result.storage.deletes.length).toBeGreaterThan(0);
  expect(result.storage.deletes).toContain(SCOPE_A);
  expect(result.storage.records.has(SCOPE_A)).toBe(false);
  expect(result.storage.records.has(SCOPE_B)).toBe(true);
  expect(result.aSnapshot.status).toBe("error");
  expect(result.bSnapshot).toEqual({
    data: { value: "B active result" },
    status: "success",
  });
  expect(result.bContainer.textContent).toBe("B active result");

  result.keyScan.release.resolve();
  releaseHeldScan = undefined;
  await pendingBinds[pendingBinds.length - 1];
});

it("an unbound denial still fails closed against the active scope", async () => {
  const storage = installStorage(
    new Map([[SCOPE_B, cacheRecord(QUERY_B, { value: "B disk result" })]]),
  );
  const fetchStarted = deferred<void>();
  const fetchReply = deferred<Response>();
  const fetchMock = vi.fn(() => {
    fetchStarted.resolve();
    return fetchReply.promise;
  });
  vi.stubGlobal("fetch", fetchMock);

  const clientB = newClient();
  let aSnapshot: Snapshot = { data: undefined, status: "pending" };
  await mount(clientB, "request-a", (next) => {
    aSnapshot = next;
  });
  await fetchStarted.promise;

  const keyScan = storage.holdNextKeyScan();
  releaseHeldScan = keyScan.release.resolve;
  const bBind = cache.bindActionQueryCache(clientB, SCOPE_B, {
    trustPrebindResults: true,
  });
  pendingBinds.push(bBind);
  await keyScan.started.promise;

  clientB.setQueryData(QUERY_B, { value: "B active result" });
  let bSnapshot: Snapshot = { data: undefined, status: "pending" };
  const bContainer = await mount(clientB, "active-b", (next) => {
    bSnapshot = next;
  });
  expect(bSnapshot).toEqual({
    data: { value: "B active result" },
    status: "success",
  });

  await act(async () => {
    fetchReply.resolve(response(403, { error: "unknown prebind denial" }));
    await expect.poll(() => aSnapshot.status).toBe("error");
  });
  await expect.poll(() => storage.records.has(SCOPE_B)).toBe(false);
  expect(bSnapshot).toEqual({
    data: { value: "B active result" },
    status: "success",
  });
  expect(bContainer.textContent).toBe("B active result");

  keyScan.release.resolve();
  releaseHeldScan = undefined;
  await bBind;
});
