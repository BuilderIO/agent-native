import "./action-query-cache.test-fixtures.js";
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act } from "react";
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

const scope = `denial-debounce-${crypto.randomUUID()}`;
const revokedKey = ["action", "probe-revoked", undefined] as const;
const retainedKey = ["action", "probe-retained", undefined] as const;

function allowed(value: string) {
  return {
    status: 200,
    body: { value },
    headers: { "X-Agent-Native-Browser-Persist": "allow" },
  };
}

function PairProbe() {
  useActionQuery<{ value: string }>("probe-revoked" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  useActionQuery<{ value: string }>("probe-retained" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  return null;
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(client: QueryClient) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PairProbe />
      </QueryClientProvider>,
    );
  });
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

it("keeps denied records absent after debounce, then persists after a fresh bind", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const records = new Map<string, PersistedClient>();
  const writes: string[] = [];
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const actionCalls = new Map<string, number>();
  let denialEnabled = false;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      writes.push(key);
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const action = url.split("/").at(-1);
    if (action === "get-actions-batch") {
      const body = JSON.parse(String(init?.body)) as {
        requests: Array<{ action: string }>;
      };
      return new Response(
        JSON.stringify({
          results: body.requests.map(({ action: name }) =>
            allowed(`${name}-result`),
          ),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const callCount = (actionCalls.get(action ?? "") ?? 0) + 1;
    actionCalls.set(action ?? "", callCount);
    if (action === "probe-revoked" && denialEnabled) {
      return new Response(JSON.stringify({ error: "denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ value: `${action}-result` }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-Browser-Persist": "allow",
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await bindActionQueryCache(client, scope);
  await mount(client);

  await expect
    .poll(() => client.getQueryData<{ value: string }>(revokedKey)?.value, {
      timeout: 1_500,
      message: `requests=${JSON.stringify(requests)}`,
    })
    .toBe("probe-revoked-result");
  await expect
    .poll(() => client.getQueryData<{ value: string }>(retainedKey)?.value)
    .toBe("probe-retained-result");
  await expect.poll(() => records.has(scope), { timeout: 2_500 }).toBe(true);
  expect(records.get(scope)?.clientState.queries).toHaveLength(2);

  denialEnabled = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: revokedKey, exact: true });
  });
  await expect
    .poll(
      () => client.getQueryCache().find({ queryKey: revokedKey })?.state.status,
    )
    .toBe("error");
  expect(client.getQueryData(revokedKey)).toBeUndefined();
  expect(client.getQueryData(retainedKey)).toEqual({
    value: "probe-retained-result",
  });
  await expect.poll(() => records.has(scope)).toBe(false);
  denialEnabled = false;

  await new Promise((resolve) => setTimeout(resolve, 1_150));
  const persistedAfterDenial = records.get(scope);
  expect(persistedAfterDenial).toBeUndefined();
  expect(writes).toHaveLength(1);
  expect(records.has(scope)).toBe(false);

  const reboundClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await bindActionQueryCache(reboundClient, scope);
  await mount(reboundClient);
  await expect
    .poll(
      () => reboundClient.getQueryData<{ value: string }>(retainedKey)?.value,
    )
    .toBe("probe-retained-result");
  await expect.poll(() => records.has(scope), { timeout: 2_500 }).toBe(true);
  expect(
    records.get(scope)?.clientState.queries.map((query) => query.queryHash),
  ).toContain(
    reboundClient.getQueryCache().find({ queryKey: retainedKey })?.queryHash,
  );
});

it("deletes a storage write that was already in flight when access was denied", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const records = new Map<string, PersistedClient>();
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const writeCompleted = deferred<void>();
  let holdNextWrite = true;
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      if (holdNextWrite) {
        holdNextWrite = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      records.set(key, value);
      writeCompleted.resolve();
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
  setActionQueryCacheStorage(storage);
  let denialEnabled = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const action = url.split("/").at(-1) ?? "";
      if (action === "get-actions-batch") {
        const body = JSON.parse(String(init?.body)) as {
          requests: Array<{ action: string }>;
        };
        return new Response(
          JSON.stringify({
            results: body.requests.map(({ action: name }) =>
              allowed(`${name}-result`),
            ),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (action === "probe-revoked" && denialEnabled) {
        return new Response(JSON.stringify({ error: "denied" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ value: `${action}-result` }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Browser-Persist": "allow",
        },
      });
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await bindActionQueryCache(client, scope);
  await mount(client);
  await expect
    .poll(() => client.getQueryData(revokedKey))
    .toEqual({ value: "probe-revoked-result" });
  await expect
    .poll(() => client.getQueryData(retainedKey))
    .toEqual({ value: "probe-retained-result" });

  await writeStarted.promise;
  denialEnabled = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: revokedKey, exact: true });
  });
  await expect
    .poll(
      () => client.getQueryCache().find({ queryKey: revokedKey })?.state.status,
    )
    .toBe("error");
  expect(records.has(scope)).toBe(false);

  releaseWrite.resolve();
  await writeCompleted.promise;
  await expect.poll(() => records.has(scope)).toBe(false);
});
