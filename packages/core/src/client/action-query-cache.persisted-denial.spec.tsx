import "./action-query-cache.test-fixtures.js";
import type { PersistedClient } from "@tanstack/query-persist-client-core";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

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
import { useActionQuery } from "./use-action.js";

type Payload = { value: string };
type Snapshot = {
  data: Payload | undefined;
  status: string;
  refetch: () => Promise<unknown>;
};

const scope = `bind-failure-persisted-denial-${crypto.randomUUID()}`;
const oldData = { value: "previously authorized persisted result" };

function response(status: number, payload: unknown, allow = false): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(allow ? { "X-Agent-Native-Browser-Persist": "allow" } : {}),
    },
  });
}

function Probe({ onSnapshot }: { onSnapshot: (value: Snapshot) => void }) {
  const query = useActionQuery<Payload>(
    "bind-failure-persisted-denial-probe" as never,
    undefined,
    {
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
  onSnapshot({
    data: query.data,
    status: query.status,
    refetch: query.refetch,
  });
  return <output>{query.data?.value ?? "empty"}</output>;
}

const roots: Array<{ root: Root; container: HTMLDivElement }> = [];
const clients = new Set<QueryClient>();

async function mount(
  client: QueryClient,
  onSnapshot: (value: Snapshot) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  clients.add(client);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe onSnapshot={onSnapshot} />
      </QueryClientProvider>,
    );
  });
  return container;
}

afterEach(async () => {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  for (const client of clients) client.clear();
  clients.clear();
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([401, 403, 404, 503])(
  "removes denied persisted action results after a failed bind when the response is %s",
  async (status) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let failKeys = false;
    const records = new Map<string, PersistedClient>();
    const storage: ActionQueryCacheStorage = {
      get: async (key) => records.get(key),
      set: async (key, value) => {
        records.set(key, value);
      },
      del: async (key) => {
        records.delete(key);
      },
      keys: async () => {
        if (failKeys) throw new Error("storage keys unavailable");
        return [...records.keys()];
      },
      clear: async () => records.clear(),
    };
    setActionQueryCacheStorage(storage);

    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        if (fetchCount === 1) return response(200, oldData, true);
        return response(status, { error: `response ${status}` });
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.add(client);
    await bindActionQueryCache(client, scope);
    let snapshot: Snapshot = {
      data: undefined,
      status: "pending",
      refetch: async () => {},
    };
    const container = await mount(client, (next) => {
      snapshot = next;
    });
    await expect.poll(() => snapshot.data).toEqual(oldData);
    await expect
      .poll(() =>
        [...(records.get(scope)?.clientState.queries ?? [])].some(
          (query) =>
            query.queryKey[1] === "bind-failure-persisted-denial-probe" &&
            (query.state.data as Payload | undefined)?.value === oldData.value,
        ),
      )
      .toBe(true);

    failKeys = true;
    await act(async () => {
      await expect(bindActionQueryCache(client, scope)).rejects.toThrow(
        "storage keys unavailable",
      );
    });
    expect(container.textContent).toBe(oldData.value);
    failKeys = false;

    await act(async () => {
      await snapshot.refetch();
    });
    await expect.poll(() => snapshot.status).toBe("error");
    if (status !== 503) expect(snapshot.data).toBeUndefined();

    const freshClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.add(freshClient);
    await bindActionQueryCache(freshClient, scope);
    expect(
      freshClient.getQueryData([
        "action",
        "bind-failure-persisted-denial-probe",
        undefined,
      ]),
    ).toEqual(status === 503 ? oldData : undefined);
  },
);
