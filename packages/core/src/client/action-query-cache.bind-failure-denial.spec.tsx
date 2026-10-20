import "./action-query-cache.test-fixtures.js";
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

const scope = `bind-failure-denial-${crypto.randomUUID()}`;
const oldData = { value: "previously authorized result" };
const postFailureData = { value: "action result after bind failure" };

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
    "bind-failure-probe" as never,
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
  return (
    <output data-query-status={query.status}>
      {query.data?.value ?? "empty"}
    </output>
  );
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

async function mount(
  client: QueryClient,
  onSnapshot: (value: Snapshot) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
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
    entry.client.clear();
  }
  await clearActionQueryCache();
  setActionQueryCacheStorage(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([401, 403, 404, 503])(
  "clears a retained observer result after bind failed and the next action returns %s",
  async (status) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let failKeys = false;
    const records = new Map();
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
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) return response(200, oldData, true);
      if (fetchCount === 2) return response(200, postFailureData, true);
      return response(status, { error: `response ${status}` });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
    expect(snapshot.status).toBe("success");

    failKeys = true;
    await expect(bindActionQueryCache(client, scope)).rejects.toThrow(
      "storage keys unavailable",
    );
    expect(container.textContent).toBe(oldData.value);

    await act(async () => {
      await snapshot.refetch();
    });
    await expect.poll(() => snapshot.data).toEqual(postFailureData);
    expect(snapshot.status).toBe("success");

    await act(async () => {
      await snapshot.refetch();
    });
    await expect.poll(() => snapshot.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(snapshot.data).toEqual(status === 503 ? postFailureData : undefined);
    expect(container.textContent).toBe(
      status === 503 ? postFailureData.value : "empty",
    );
  },
);
