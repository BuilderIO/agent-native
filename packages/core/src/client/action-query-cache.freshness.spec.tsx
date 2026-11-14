// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  ACTION_BROWSER_PERSIST_ALLOW,
  ACTION_BROWSER_PERSIST_HEADER,
} from "../shared/action-browser-persist.js";
import { cacheBuster } from "./action-query-cache.test-fixtures.js";
import { useActionMutation, useActionQuery } from "./use-action.js";

it("does not reload a pre-write disk snapshot as fresh after a mutation", async () => {
  const cache = await import("./action-query-cache.js");
  const scope = `mutation-reload-${crypto.randomUUID()}`;
  const key = ["action", "read-item", undefined] as const;
  const source = new QueryClient();
  source.setQueryData(key, { value: "old" });
  let stored: PersistedClient | undefined = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  cache.setActionQueryCacheStorage({
    get: async () => stored,
    set: async (_key, value) => {
      stored = value;
    },
    del: async () => {
      stored = undefined;
    },
    keys: async () => [scope],
    clear: async () => {
      stored = undefined;
    },
  });
  let release: (value: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) => {
      if (String(url).includes("write-item"))
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      if (++reads === 1) return pending;
      return Promise.resolve(
        new Response(JSON.stringify({ value: "fresh" }), { status: 200 }),
      );
    }),
  );
  const makeClient = () =>
    new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
  const first = makeClient();
  const reloaded = makeClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mutate: (() => Promise<unknown>) | undefined;
  function Probe() {
    const query = useActionQuery<{ value: string }>(
      "read-item" as never,
      undefined,
      { batchRefetches: false },
    );
    const mutation = useActionMutation("write-item" as never);
    mutate = () => mutation.mutateAsync(undefined as never);
    return <span>{query.data?.value ?? "loading"}</span>;
  }
  try {
    await cache.bindActionQueryCache(first, scope);
    await act(async () =>
      root.render(
        <QueryClientProvider client={first}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    expect(container.textContent).toBe("old");
    if (!mutate) throw new Error("missing mutation");
    await act(async () => {
      await mutate?.();
    });
    await vi.waitFor(() => expect(reads).toBe(1));
    await act(async () =>
      root.render(
        <QueryClientProvider client={first}>
          <div>other page</div>
        </QueryClientProvider>,
      ),
    );
    release(new Response(JSON.stringify({ value: "fresh" }), { status: 200 }));
    await cache.bindActionQueryCache(reloaded, scope);
    await act(async () =>
      root.render(
        <QueryClientProvider client={reloaded}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toBe("fresh"));
  } finally {
    act(() => root.unmount());
    container.remove();
    await cache.clearActionQueryCache();
    source.clear();
    first.clear();
    reloaded.clear();
    vi.unstubAllGlobals();
  }
});

it("does not certify an older tab's snapshot after another tab writes", async () => {
  const cache = await import("./action-query-cache.js");
  const scope = `other-tab-${crypto.randomUUID()}`;
  const key = ["action", "read-item", undefined] as const;
  const source = new QueryClient();
  source.setQueryData(key, { value: "old" });
  let stored: PersistedClient | undefined = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  let writes = 0;
  cache.setActionQueryCacheStorage({
    get: async () => stored,
    set: async (_key, value) => {
      writes++;
      stored = value;
    },
    del: async () => {
      stored = undefined;
    },
    keys: async () => [scope],
    clear: async () => {
      stored = undefined;
    },
  });
  const first = new QueryClient();
  const reloaded = new QueryClient();
  try {
    await cache.bindActionQueryCache(first, scope);
    // This is the shared localStorage event written by a different tab.
    window.localStorage.setItem(
      "agent-native.action-query-cache.mutation-epoch",
      crypto.randomUUID(),
    );
    first.setQueryData(key, { value: "still old" });
    await vi.waitFor(() => expect(writes).toBeGreaterThan(0), {
      timeout: 3000,
    });
    await cache.bindActionQueryCache(reloaded, scope);
    expect(reloaded.getQueryState(key)?.data).toEqual({ value: "still old" });
    expect(reloaded.getQueryState(key)?.isInvalidated).toBe(true);
  } finally {
    await cache.clearActionQueryCache();
    window.localStorage.removeItem(
      "agent-native.action-query-cache.mutation-epoch",
    );
    source.clear();
    first.clear();
    reloaded.clear();
  }
});

it("marks an old snapshot stale when a write completes before cache binding", async () => {
  const cache = await import("./action-query-cache.js");
  const scope = `prebind-${crypto.randomUUID()}`;
  const key = ["action", "read-item", undefined] as const;
  const source = new QueryClient();
  source.setQueryData(key, { value: "old" });
  const stored: PersistedClient = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  cache.setActionQueryCacheStorage({
    get: async () => stored,
    set: async () => {},
    del: async () => {},
    keys: async () => [scope],
    clear: async () => {},
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
  );
  const client = new QueryClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mutate: (() => Promise<unknown>) | undefined;
  function Probe() {
    const mutation = useActionMutation("write-item" as never);
    mutate = () => mutation.mutateAsync(undefined as never);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    if (!mutate) throw new Error("missing mutation");
    await act(async () => {
      await mutate?.();
    });
    await cache.bindActionQueryCache(client, scope);
    expect(client.getQueryState(key)?.data).toEqual({ value: "old" });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
    await cache.clearActionQueryCache();
    source.clear();
    client.clear();
    vi.unstubAllGlobals();
  }
});

it("keeps unchanged and subsequently refreshed snapshots fresh without extra requests", async () => {
  const cache = await import("./action-query-cache.js");
  const scope = `fresh-restore-${crypto.randomUUID()}`;
  const key = ["action", "read-item", undefined] as const;
  window.localStorage.removeItem(
    "agent-native.action-query-cache.mutation-epoch",
  );
  const source = new QueryClient();
  source.setQueryData(key, { value: "old" });
  let stored: PersistedClient | undefined = {
    timestamp: Date.now(),
    buster: cacheBuster(),
    clientState: dehydrate(source),
  };
  let writes = 0;
  cache.setActionQueryCacheStorage({
    get: async () => stored,
    set: async (_key, value) => {
      stored = value;
      writes++;
    },
    del: async () => {
      stored = undefined;
    },
    keys: async () => [scope],
    clear: async () => {
      stored = undefined;
    },
  });
  let reads = 0;
  const fetchMock = vi.fn((url: string | URL | Request) => {
    if (String(url).includes("write-item"))
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    reads++;
    return Promise.resolve(
      new Response(JSON.stringify({ value: "fresh" }), {
        status: 200,
        headers: {
          [ACTION_BROWSER_PERSIST_HEADER]: ACTION_BROWSER_PERSIST_ALLOW,
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const makeClient = () =>
    new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
  const first = makeClient(),
    next = makeClient(),
    last = makeClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mutate: (() => Promise<unknown>) | undefined;
  function Probe() {
    const query = useActionQuery<{ value: string }>(
      "read-item" as never,
      undefined,
      { batchRefetches: false },
    );
    const mutation = useActionMutation("write-item" as never);
    mutate = () => mutation.mutateAsync(undefined as never);
    return <span>{query.data?.value ?? "loading"}</span>;
  }
  const render = (client: QueryClient) =>
    act(async () =>
      root.render(
        <QueryClientProvider
          key={client === first ? "first" : client === next ? "next" : "last"}
          client={client}
        >
          <Probe />
        </QueryClientProvider>,
      ),
    );
  try {
    await cache.bindActionQueryCache(first, scope);
    await render(first);
    expect(container.textContent).toBe("old");
    expect(reads).toBe(0);
    if (!mutate) throw new Error("missing mutation");
    await act(async () => {
      await mutate?.();
    });
    await vi.waitFor(() => expect(container.textContent).toBe("fresh"));
    await vi.waitFor(() => expect(writes).toBeGreaterThan(0), {
      timeout: 3000,
    });
    await cache.bindActionQueryCache(next, scope);
    await render(next);
    await vi.waitFor(() => expect(reads).toBe(2));
    await vi.waitFor(() =>
      expect(next.getQueryState(key)?.fetchStatus).toBe("idle"),
    );
    const beforeNextWrite = writes;
    await vi.waitFor(() => expect(writes).toBeGreaterThan(beforeNextWrite), {
      timeout: 3000,
    });
    await cache.bindActionQueryCache(last, scope);
    await render(last);
    expect(container.textContent).toBe("fresh");
    expect(reads).toBe(2);
  } finally {
    act(() => root.unmount());
    container.remove();
    await cache.clearActionQueryCache();
    source.clear();
    first.clear();
    next.clear();
    last.clear();
    vi.unstubAllGlobals();
  }
});

it.each(["read", "write"] as const)(
  "revokes the stored snapshot when mutation generation %s fails",
  async (failure) => {
    const cache = await import("./action-query-cache.js");
    const scope = `storage-failure-${crypto.randomUUID()}`;
    const key = ["action", "read-item", undefined] as const;
    const source = new QueryClient();
    source.setQueryData(key, { value: "old" });
    let stored: PersistedClient | undefined = {
      timestamp: Date.now(),
      buster: cacheBuster(),
      clientState: dehydrate(source),
    };
    const remove = vi.fn(async () => {
      stored = undefined;
    });
    cache.setActionQueryCacheStorage({
      get: async () => stored,
      set: async (_key, value) => {
        stored = value;
      },
      del: remove,
      keys: async () => [scope],
      clear: async () => {
        stored = undefined;
      },
    });
    const first = new QueryClient(),
      next = new QueryClient();
    const previousStorage = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const values = new Map<string, string>();
    for (let i = 0; i < window.localStorage.length; i++) {
      const name = window.localStorage.key(i);
      if (name) {
        const value = window.localStorage.getItem(name);
        if (value !== null) values.set(name, value);
      }
    }
    let failStorage = true;
    const local = {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem(name: string) {
        if (
          failStorage &&
          failure === "read" &&
          name === "agent-native.action-query-cache.mutation-epoch"
        )
          throw new Error("read failed");
        return values.get(name) ?? null;
      },
      setItem(name: string, value: string) {
        if (
          failStorage &&
          failure === "write" &&
          name === "agent-native.action-query-cache.mutation-epoch"
        )
          throw new Error("write failed");
        values.set(name, value);
      },
      removeItem: (name: string) => {
        values.delete(name);
      },
      clear: () => values.clear(),
    } satisfies Storage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: local,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let mutate: (() => Promise<unknown>) | undefined;
    function Probe() {
      const m = useActionMutation("write-item" as never);
      mutate = () => m.mutateAsync(undefined as never);
      return null;
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        ),
    );
    try {
      await cache.bindActionQueryCache(first, scope);
      if (failure === "write") {
        expect(first.getQueryData(key)).toEqual({ value: "old" });
        await act(async () =>
          root.render(
            <QueryClientProvider client={first}>
              <Probe />
            </QueryClientProvider>,
          ),
        );
        if (!mutate) throw new Error("missing mutation");
        await act(async () => {
          await mutate?.();
        });
      }
      await vi.waitFor(() => expect(remove).toHaveBeenCalled());
      failStorage = false;
      await cache.bindActionQueryCache(next, scope);
      expect(next.getQueryData(key)).toBeUndefined();
    } finally {
      failStorage = false;
      act(() => root.unmount());
      container.remove();
      await cache.clearActionQueryCache();
      if (previousStorage)
        Object.defineProperty(window, "localStorage", previousStorage);
      source.clear();
      first.clear();
      next.clear();
      vi.unstubAllGlobals();
    }
  },
);
