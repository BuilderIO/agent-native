// @vitest-environment happy-dom

import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  session: null as {
    email: string;
    userId: string;
    orgId?: string | null;
  } | null,
}));
vi.mock("./use-session.js", () => ({
  useSession: () => ({
    session: sessionMocks.session,
    status: sessionMocks.session ? "authenticated" : "unauthenticated",
    isLoading: false,
    error: null,
    retry: () => {},
  }),
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import {
  ActionQueryCacheGate,
  actionQueryCacheScope,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
import { useActionMutation, useActionQuery } from "./use-action.js";

const ALICE = {
  email: "alice@example.com",
  userId: "user-alice",
  orgId: "org-1",
};
const BOB = { email: "bob@example.com", userId: "user-bob", orgId: "org-1" };
const ALICE_SCOPE = actionQueryCacheScope(ALICE, "");
const BOB_SCOPE = actionQueryCacheScope(BOB, "");
// Longer than the coalesced write window, so a pending write has landed.
const WRITE_SETTLE_MS = 1_100;

interface Designs {
  designs: Array<{ title: string }>;
}

function memoryStorage() {
  const records = new Map<string, PersistedClient>();
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

function designsResponse(title: string, { persist = true } = {}): Response {
  return new Response(
    JSON.stringify({ designs: [{ title }] } satisfies Designs),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(persist ? { "X-Agent-Native-Browser-Persist": "allow" } : {}),
      },
    },
  );
}

function stubFetch(respond: () => Promise<Response> | Response) {
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      requests += 1;
      return respond();
    }),
  );
  return () => requests;
}

describe("ActionQueryCacheGate", () => {
  const roots: Array<{ root: Root; container: HTMLDivElement }> = [];

  function settle(ms: number) {
    return act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async function settleUntil(done: () => boolean, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (!done() && Date.now() < deadline) await settle(50);
  }

  async function mount(queryClient: QueryClient, ui: React.ReactElement) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ActionQueryCacheGate>{ui}</ActionQueryCacheGate>
        </QueryClientProvider>,
      ),
    );
    return container;
  }

  async function unmountAll() {
    for (const { root, container } of roots.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
  }

  beforeEach(() => {
    sessionMocks.session = ALICE;
  });

  afterEach(async () => {
    await unmountAll();
    setActionQueryCacheStorage(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Render = { title: string | undefined; requests: number };

  function Designs({
    onRender,
  }: {
    onRender: (title: string | undefined) => void;
  }) {
    const query = useActionQuery<Designs>("list-designs" as never);
    onRender(query.data?.designs[0]?.title);
    return null;
  }

  it("paints the cached result before any action request, then revalidates", async () => {
    const { storage, records } = memoryStorage();
    setActionQueryCacheStorage(storage);
    const firstVisit = new QueryClient();
    stubFetch(() => designsResponse("saved-last-visit"));
    await mount(firstVisit, <Designs onRender={() => {}} />);
    await settle(WRITE_SETTLE_MS);
    await unmountAll();
    expect(records.get(ALICE_SCOPE)).toBeDefined();

    let release!: (response: Response) => void;
    const requestCount = stubFetch(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const renders: Render[] = [];
    await mount(
      new QueryClient(),
      <Designs
        onRender={(title) => renders.push({ title, requests: requestCount() })}
      />,
    );
    await settle(50);

    const painted = renders.find((render) => render.title !== undefined);
    expect(painted).toEqual({ title: "saved-last-visit", requests: 0 });

    release(designsResponse("fresh-from-server"));
    await settle(50);
    expect(renders.at(-1)?.title).toBe("fresh-from-server");
    expect(requestCount()).toBe(1);
  });

  it("never reads another user's cached results, and drops their record", async () => {
    const { storage, records } = memoryStorage();
    setActionQueryCacheStorage(storage);
    stubFetch(() => designsResponse("alice-private"));
    await mount(new QueryClient(), <Designs onRender={() => {}} />);
    await settle(WRITE_SETTLE_MS);
    await unmountAll();
    expect(records.has(ALICE_SCOPE)).toBe(true);

    sessionMocks.session = BOB;
    stubFetch(() => designsResponse("bob-own"));
    const titles: Array<string | undefined> = [];
    await mount(
      new QueryClient(),
      <Designs onRender={(title) => titles.push(title)} />,
    );
    await settle(50);

    expect(titles).not.toContain("alice-private");
    expect(titles.at(-1)).toBe("bob-own");
    expect(records.has(ALICE_SCOPE)).toBe(false);
  });

  it("clears on sign-out and keeps a write that was pending at that moment from landing", async () => {
    const { storage, records } = memoryStorage();
    setActionQueryCacheStorage(storage);
    const client = new QueryClient();
    stubFetch(() => designsResponse("before-sign-out"));
    await mount(client, <Designs onRender={() => {}} />);
    await settle(WRITE_SETTLE_MS);
    expect(records.has(ALICE_SCOPE)).toBe(true);

    client.setQueryData<Designs>(["action", "list-designs", undefined], {
      designs: [{ title: "changed-just-now" }],
    });
    await clearActionQueryCache();
    await settle(WRITE_SETTLE_MS);

    expect(records.size).toBe(0);
  });

  it("does not paint results saved by an earlier build", async () => {
    const { storage, records } = memoryStorage();
    setActionQueryCacheStorage(storage);
    vi.stubGlobal("__AGENT_NATIVE_BUILD_ID__", "build-1");
    stubFetch(() => designsResponse("build-1-result"));
    await mount(new QueryClient(), <Designs onRender={() => {}} />);
    await settle(WRITE_SETTLE_MS);
    await unmountAll();

    vi.stubGlobal("__AGENT_NATIVE_BUILD_ID__", "build-2");
    stubFetch(() => new Promise<Response>(() => {}));
    const titles: Array<string | undefined> = [];
    await mount(
      new QueryClient(),
      <Designs onRender={(title) => titles.push(title)} />,
    );
    await settle(50);

    expect(titles).not.toContain("build-1-result");
    expect(records.size).toBe(0);
  });

  it("discards a record stored under another schema version", async () => {
    const { storage, records } = memoryStorage();
    setActionQueryCacheStorage(storage);
    const stale = new QueryClient();
    stale.setQueryData<Designs>(["action", "list-designs", undefined], {
      designs: [{ title: "stale-schema" }],
    });
    records.set(ALICE_SCOPE, {
      timestamp: Date.now(),
      buster: "action-query-cache-v0",
      clientState: dehydrate(stale),
    });

    const titles: Array<string | undefined> = [];
    stubFetch(() => new Promise<Response>(() => {}));
    await mount(
      new QueryClient(),
      <Designs onRender={(title) => titles.push(title)} />,
    );
    await settle(50);

    expect(titles).not.toContain("stale-schema");
    expect(records.has(ALICE_SCOPE)).toBe(false);
  });

  it("keeps results the server did not mark for the browser, and mutations, out of the store", async () => {
    const { storage, records } = memoryStorage();
    setActionQueryCacheStorage(storage);
    stubFetch(() => designsResponse("not-for-disk", { persist: false }));
    await mount(new QueryClient(), <Designs onRender={() => {}} />);
    await settle(WRITE_SETTLE_MS);
    expect(records.has(ALICE_SCOPE)).toBe(true);
    expect(records.get(ALICE_SCOPE)?.clientState.queries).toEqual([]);
    await unmountAll();

    function Save() {
      const save = useActionMutation("save-design" as never);
      return <button onClick={() => save.mutate({} as never)}>save</button>;
    }
    // A mutation still in flight is exactly what a default dehydrate would keep.
    stubFetch(() => new Promise<Response>(() => {}));
    const container = await mount(new QueryClient(), <Save />);
    const button = container.querySelector("button");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle(WRITE_SETTLE_MS);

    expect(records.get(ALICE_SCOPE)?.clientState.mutations).toEqual([]);
  });

  it("stops holding queries after the restore timeout when the store never answers", async () => {
    const { storage } = memoryStorage();
    setActionQueryCacheStorage({
      ...storage,
      get: () => new Promise<PersistedClient | undefined>(() => {}),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const liveRequests = stubFetch(() => designsResponse("live"));
    const titles: Array<string | undefined> = [];
    await mount(
      new QueryClient(),
      <Designs onRender={(title) => titles.push(title)} />,
    );
    await settleUntil(() => titles.at(-1) === "live", 5_000);

    expect(titles.at(-1)).toBe("live");
    expect(liveRequests()).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("did not restore in time"),
    );
  });
});
