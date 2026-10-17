import "./action-query-cache.test-fixtures.js";
// @vitest-environment happy-dom
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./use-session.js", () => ({
  useSession: () => ({ session: null, status: "unavailable", isLoading: true }),
  isSessionFromFirstRead: () => false,
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));

import * as cache from "./action-query-cache.js";
import type { ActionQueryCacheStorage } from "./action-query-cache.js";
import { useActionQuery } from "./use-action.js";

const scopeA = "clear-caller-timeout-a";
const scopeB = "clear-caller-timeout-b";
const events: string[] = [];
const records = new Map<string, PersistedClient>();
const clients: QueryClient[] = [];
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
let releaseWrite: (() => void) | undefined;
let pendingClear: Promise<void> | undefined;
let pendingBind: Promise<void> | undefined;
let resolveWriteStarted!: () => void;
const writeStarted = new Promise<void>((resolve) => {
  resolveWriteStarted = resolve;
});

const storage: ActionQueryCacheStorage = {
  get: async (key) => {
    events.push(`get:${key}`);
    return records.get(key);
  },
  set: async (key, value) => {
    events.push(`set:start:${key}`);
    if (key === scopeA) {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
        resolveWriteStarted();
      });
    }
    records.set(key, value);
    events.push(`set:end:${key}`);
  },
  del: async (key) => {
    events.push(`del:${key}`);
    records.delete(key);
  },
  keys: async () => {
    events.push("keys");
    return [...records.keys()];
  },
  clear: async () => {
    events.push("clear:start");
    records.clear();
    events.push("clear:end");
  },
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

function OwnerProbe() {
  const query = useActionQuery<{ owner: string }>(
    "list-designs" as never,
    undefined,
    { retry: false, refetchOnMount: false, refetchOnWindowFocus: false },
  );
  return <span data-testid="owner">{query.data?.owner ?? "loading"}</span>;
}

async function mount(client: QueryClient): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <OwnerProbe />
      </QueryClientProvider>,
    );
  });
  return container;
}

async function waitForOwner(
  container: HTMLDivElement,
  owner: string,
): Promise<void> {
  await act(async () => {
    await expect
      .poll(() => container.querySelector("[data-testid=owner]")?.textContent, {
        timeout: 3_500,
      })
      .toBe(owner);
  });
}

afterEach(async () => {
  releaseWrite?.();
  await Promise.allSettled(
    [pendingClear, pendingBind].filter(Boolean) as Promise<void>[],
  );
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  await cache.clearActionQueryCache();
  cache.setActionQueryCacheStorage(undefined);
  for (const client of clients.splice(0)) client.clear();
  records.clear();
  events.length = 0;
  releaseWrite = undefined;
  pendingClear = undefined;
  pendingBind = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("bounds the clear caller and holds new storage access behind the background clear", async () => {
  cache.setActionQueryCacheStorage(storage);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ owner: "fresh A" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Native-Browser-Persist": "allow",
          },
        }),
    ),
  );

  const clientA = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientA);
  await cache.bindActionQueryCache(clientA, scopeA);
  const containerA = await mount(clientA);
  await waitForOwner(containerA, "fresh A");
  await Promise.race([
    writeStarted,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("storage write did not start")), 3_500),
    ),
  ]);
  const ownerProbe = mounted.pop();
  if (ownerProbe) {
    await act(async () => ownerProbe.root.unmount());
    ownerProbe.container.remove();
  }

  let clearReturned = false;
  let clearError: unknown;
  pendingClear = cache.clearActionQueryCache().then(
    () => {
      clearReturned = true;
    },
    (error) => {
      clearError = error;
      clearReturned = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 2_250));
  expect(clearReturned).toBe(true);
  expect(clearError).toMatchObject({
    message: expect.stringMatching(/timed out/i),
  });
  expect(events).toContain(`set:start:${scopeA}`);
  expect(events).not.toContain(`set:end:${scopeA}`);
  expect(events).not.toContain("clear:start");

  const priorEventCount = events.length;
  const clientB = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(clientB);
  let bindReturned = false;
  pendingBind = cache.bindActionQueryCache(clientB, scopeB).then(() => {
    bindReturned = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(bindReturned).toBe(false);
  expect(events.slice(priorEventCount)).toEqual([]);

  releaseWrite?.();
  await Promise.all([pendingClear, pendingBind]);
  expect(bindReturned).toBe(true);
  const writeEnd = events.indexOf(`set:end:${scopeA}`);
  const clearStart = events.indexOf("clear:start");
  const clearEnd = events.indexOf("clear:end");
  const keysAfterClear = events.indexOf("keys", clearEnd + 1);
  const readB = events.indexOf(`get:${scopeB}`);
  expect(writeEnd).toBeGreaterThanOrEqual(0);
  expect(writeEnd).toBeLessThan(clearStart);
  expect(clearStart).toBeLessThan(clearEnd);
  expect(clearEnd).toBeLessThan(keysAfterClear);
  expect(clearEnd).toBeLessThan(readB);
});
