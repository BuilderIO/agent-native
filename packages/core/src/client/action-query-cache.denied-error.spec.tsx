import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  dehydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { cacheBuster } from "./action-query-cache.test-fixtures.js";

const sessionState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let session: { email: string; userId: string; orgId: string } | null = null;
  let firstRead = false;
  return {
    read: () => session,
    firstRead: () => firstRead,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(
      next: { email: string; userId: string; orgId: string } | null,
      trustedFirstRead: boolean,
    ) {
      session = next;
      firstRead = trustedFirstRead;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("./use-session.js", async () => {
  const react = await import("react");
  return {
    useSession: () => {
      const session = react.useSyncExternalStore(
        sessionState.subscribe,
        sessionState.read,
        () => null,
      );
      return {
        session,
        status: session ? "authenticated" : "loading",
        isLoading: !session,
        error: null,
        retry: () => {},
      };
    },
    isSessionFromFirstRead: () => sessionState.firstRead(),
    recheckSessionAfterUnauthorized: vi.fn(),
  };
});
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import {
  ActionQueryCacheGate,
  actionQueryCacheScope,
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
import { clientBuildId } from "./build-compatibility.js";
import { useActionQuery } from "./use-action.js";

const USER_A = {
  email: "a@example.test",
  userId: "scope-user-a",
  orgId: "org-a",
};
const USER_B = {
  email: "b@example.test",
  userId: "scope-user-b",
  orgId: "org-b",
};
const SCOPE_A = actionQueryCacheScope(USER_A, clientBuildId());
const SCOPE_B = actionQueryCacheScope(USER_B, clientBuildId());
const DENIED_KEY = ["action", "get-private-data", undefined] as const;
const HELD_KEY = ["action", "list-designs", undefined] as const;
type Snapshot = {
  userId: string | undefined;
  status: string;
  fetchStatus: string;
  errorStatus: number | undefined;
  errorMessage: string | undefined;
  heldTitle: string | undefined;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function cacheRecord(key: readonly unknown[], data: unknown): PersistedClient {
  const source = new QueryClient();
  source.setQueryData(key, data, { updatedAt: Date.now() - 25 });
  const record: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  source.clear();
  return record;
}

function memoryStorage(seed: Array<[string, PersistedClient]> = []) {
  const records = new Map(seed);
  const reads: string[] = [];
  const storage: ActionQueryCacheStorage = {
    get: async (key) => {
      reads.push(key);
      return records.get(key);
    },
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  return { records, reads, storage };
}

function singleActionResponse(
  action: string,
  denyPrivate: boolean,
  denialMessage: string,
) {
  if (action === "get-private-data" && denyPrivate) {
    return new Response(JSON.stringify({ error: denialMessage }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (action === "get-private-data") {
    return new Response(JSON.stringify({ value: "bob-private" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({ designs: [{ title: "saved for Bob" }] }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-Browser-Persist": "allow",
      },
    },
  );
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];
function BobHeldRecord() {
  const held = useActionQuery<{ designs: Array<{ title: string }> }>(
    "list-designs" as never,
    undefined,
    {
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
  return (
    <span data-testid="held">{held.data?.designs[0]?.title ?? "pending"}</span>
  );
}

function Probe({ onSnapshot }: { onSnapshot: (snapshot: Snapshot) => void }) {
  const session = useSyncExternalStore(
    sessionState.subscribe,
    sessionState.read,
    () => null,
  );
  const denied = useActionQuery<{ value: string }>(
    "get-private-data" as never,
    undefined,
    {
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
  const error = denied.error as (Error & { status?: number }) | null;
  onSnapshot({
    userId: session?.userId,
    status: denied.status,
    fetchStatus: denied.fetchStatus,
    errorStatus: error?.status,
    errorMessage: error?.message,
    heldTitle: session?.userId === USER_B.userId ? undefined : undefined,
  });
  return (
    <output data-testid="snapshot">
      {`${session?.userId ?? "none"}:${denied.status}:${error?.status ?? "none"}`}
      {session?.userId === USER_B.userId ? <BobHeldRecord /> : null}
    </output>
  );
}

async function mount(
  client: QueryClient,
  gate: boolean,
  snapshots: Snapshot[],
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {gate ? (
          <ActionQueryCacheGate>
            <Probe onSnapshot={(snapshot) => snapshots.push(snapshot)} />
          </ActionQueryCacheGate>
        ) : (
          <Probe onSnapshot={(snapshot) => snapshots.push(snapshot)} />
        )}
      </QueryClientProvider>,
    );
  });
  return container;
}

afterEach(async () => {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
    entry.client.clear();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  sessionState.set(null, false);
  resetActionFailureCircuits();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("clears prior-scope denial UI and refetches after durable invalidation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionState.set(USER_A, false);
  const { records, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const nextBobFetch = deferred<Response>();
  let privateRequestCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const action =
      new URL(String(input), "http://localhost").pathname.split("/").at(-1) ??
      "";
    if (action === "get-private-data") {
      privateRequestCount += 1;
      if (privateRequestCount === 1)
        return singleActionResponse(action, true, "Alice private data denied");
      return nextBobFetch.promise;
    }
    return singleActionResponse(action, false, "");
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await bindActionQueryCache(client, SCOPE_A);
  const snapshots: Snapshot[] = [];
  await mount(client, false, snapshots);
  await expect
    .poll(
      () => client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.status,
    )
    .toBe("error");
  expect(
    client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.error,
  ).toMatchObject({ status: 403 });

  records.set(
    SCOPE_B,
    cacheRecord(HELD_KEY, { designs: [{ title: "saved for Bob" }] }),
  );
  await act(async () => bindActionQueryCache(client, SCOPE_B));
  expect(records.has(SCOPE_B)).toBe(false);
  expect(client.getQueryData(HELD_KEY)).toBeUndefined();

  const container = roots.at(-1)?.container;
  const bobStart = snapshots.length;
  await act(async () => sessionState.set(USER_B, false));
  await expect
    .poll(() => snapshots.some((snapshot) => snapshot.userId === USER_B.userId))
    .toBe(true);
  const bobBeforeFetch = snapshots
    .slice(bobStart)
    .filter((snapshot) => snapshot.userId === USER_B.userId);
  expect(
    bobBeforeFetch.some(
      (snapshot) =>
        snapshot.errorMessage ===
        "Action get-private-data failed: Alice private data denied",
    ),
  ).toBe(false);
  expect(container?.querySelector('[data-testid="held"]')?.textContent).toBe(
    "pending",
  );

  const bobFetchStart = snapshots.length;
  await act(async () => {
    void client.refetchQueries({ queryKey: DENIED_KEY, exact: true });
    await Promise.resolve();
  });
  await expect.poll(() => privateRequestCount).toBe(2);
  const bobDuringFetch = snapshots
    .slice(bobFetchStart)
    .filter((snapshot) => snapshot.userId === USER_B.userId);
  expect(
    bobDuringFetch.some(
      (snapshot) =>
        snapshot.errorMessage ===
        "Action get-private-data failed: Alice private data denied",
    ),
  ).toBe(false);

  await act(async () =>
    nextBobFetch.resolve(singleActionResponse("get-private-data", false, "")),
  );
  await expect
    .poll(() => client.getQueryData<{ value: string }>(DENIED_KEY)?.value)
    .toBe("bob-private");
  expect(records.has(SCOPE_B)).toBe(false);
});

it("keeps same-scope denial evidence fail-closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionState.set(USER_A, false);
  const { records, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const action =
        new URL(String(input), "http://localhost").pathname.split("/").at(-1) ??
        "";
      return singleActionResponse(
        action,
        action === "get-private-data",
        "Alice private data denied",
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await bindActionQueryCache(client, SCOPE_A);
  const snapshots: Snapshot[] = [];
  await mount(client, false, snapshots);
  await expect
    .poll(
      () => client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.status,
    )
    .toBe("error");

  records.set(
    SCOPE_A,
    cacheRecord(HELD_KEY, { designs: [{ title: "Alice prior result" }] }),
  );
  await act(async () => bindActionQueryCache(client, SCOPE_A));
  await expect.poll(() => records.has(SCOPE_A)).toBe(false);
  expect(
    client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.error,
  ).toMatchObject({ status: 403 });
  expect(client.getQueryData(HELD_KEY)).toBeUndefined();
});

it("keeps unknown pre-bind denial evidence fail-closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionState.set(USER_A, false);
  const { records, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const action =
      new URL(String(input), "http://localhost").pathname.split("/").at(-1) ??
      "";
    return singleActionResponse(
      action,
      action === "get-private-data",
      "Unknown pre-bind denial",
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const snapshots: Snapshot[] = [];
  await mount(client, false, snapshots);
  await expect
    .poll(
      () => client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.status,
    )
    .toBe("error");
  expect(
    client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.error,
  ).toMatchObject({ status: 403 });

  records.set(
    SCOPE_B,
    cacheRecord(HELD_KEY, { designs: [{ title: "saved for Bob" }] }),
  );
  await act(async () => bindActionQueryCache(client, SCOPE_B));
  await expect.poll(() => records.has(SCOPE_B)).toBe(false);
  expect(
    client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.error,
  ).toMatchObject({ status: 403 });
  expect(client.getQueryData(HELD_KEY)).toBeUndefined();
});

it("characterizes Gate scope changes separately from direct binding", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionState.set(USER_A, false);
  const { records, storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  const bobFetch = deferred<Response>();
  let privateRequestCount = 0;
  const batchedActions: string[][] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const action = url.pathname.split("/").at(-1) ?? "";
      if (action === "get-actions-batch") {
        const requestBody = JSON.parse(String(init?.body)) as {
          requests: Array<{ action: string }>;
        };
        batchedActions.push(requestBody.requests.map(({ action }) => action));
        const results = await Promise.all(
          requestBody.requests.map(async ({ action: requestedAction }) => {
            let response: Response;
            if (requestedAction === "get-private-data") {
              privateRequestCount += 1;
              response =
                privateRequestCount === 1
                  ? singleActionResponse(
                      requestedAction,
                      true,
                      "Alice private data denied",
                    )
                  : await bobFetch.promise;
            } else {
              response = singleActionResponse(requestedAction, false, "");
            }
            const payload = await response.json();
            return {
              status: response.status,
              ...(response.ok ? { body: payload } : { error: payload }),
              headers: Object.fromEntries(response.headers.entries()),
            };
          }),
        );
        return new Response(JSON.stringify({ results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const denied = action === "get-private-data";
      if (denied) {
        privateRequestCount += 1;
        if (privateRequestCount === 1)
          return singleActionResponse(
            action,
            true,
            "Alice private data denied",
          );
        return bobFetch.promise;
      }
      return singleActionResponse(action, false, "");
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const snapshots: Snapshot[] = [];
  await mount(client, true, snapshots);
  await expect
    .poll(
      () => client.getQueryCache().find({ queryKey: DENIED_KEY })?.state.status,
    )
    .toBe("error");

  records.set(
    SCOPE_B,
    cacheRecord(HELD_KEY, { designs: [{ title: "saved for Bob" }] }),
  );
  const container = roots.at(-1)?.container;
  const bobStart = snapshots.length;
  await act(async () => sessionState.set(USER_B, false));
  await expect
    .poll(() => snapshots.some((snapshot) => snapshot.userId === USER_B.userId))
    .toBe(true);
  const bobSnapshots = snapshots
    .slice(bobStart)
    .filter((snapshot) => snapshot.userId === USER_B.userId);
  expect(
    bobSnapshots.some(
      (snapshot) =>
        snapshot.errorMessage ===
        "Action get-private-data failed: Alice private data denied",
    ),
  ).toBe(false);
  expect(container?.querySelector('[data-testid="held"]')?.textContent).toBe(
    "pending",
  );
  await act(async () =>
    bobFetch.resolve(singleActionResponse("get-private-data", false, "")),
  );
  await expect
    .poll(() => client.getQueryData<{ value: string }>(DENIED_KEY)?.value)
    .toBe("bob-private");
  expect(
    batchedActions.some(
      (actions) =>
        actions.includes("get-private-data") &&
        actions.includes("list-designs"),
    ),
  ).toBe(true);
});
