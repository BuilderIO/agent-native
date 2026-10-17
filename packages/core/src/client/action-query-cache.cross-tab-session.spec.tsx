// @vitest-environment happy-dom

import "./action-query-cache.test-fixtures.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  ActionQueryCacheGate,
  clearActionQueryCache,
  setActionQueryCacheStorage,
} from "./action-query-cache.js";
import {
  ALICE,
  designsResponse,
  memoryStorage,
  sessionResponse,
  stubFetch,
} from "./action-query-cache.session-test-fixture.js";
import { useActionQuery } from "./use-action.js";
import { useSession } from "./use-session.js";

const EPOCH_KEY = "agent-native.action-query-cache.epoch";
const SESSION_INVALIDATION_KEY = "agent-native:session-invalidated";
const ACTION_KEY = ["action", "list-designs", undefined] as const;

type Designs = { designs: Array<{ title: string }> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installMutableLocalStorage() {
  const previous = Object.getOwnPropertyDescriptor(window, "localStorage");
  const values = new Map<string, string>();
  values.set(
    EPOCH_KEY,
    window.localStorage.getItem(EPOCH_KEY) ?? "cache-test-epoch",
  );
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  } satisfies Storage;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  return {
    values,
    restore() {
      if (previous) Object.defineProperty(window, "localStorage", previous);
      else Reflect.deleteProperty(window, "localStorage");
    },
  };
}

function SessionContentGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.status === "loading" || session.status === "unavailable") {
    return <div data-testid="loading-fallback">Loading</div>;
  }
  if (!session.session) return <div data-testid="signed-out">Signed out</div>;
  return (
    <>
      <span data-testid="session-status">{session.status}</span>
      {children}
    </>
  );
}

function AuthenticatedData() {
  const query = useActionQuery<Designs>("list-designs" as never);
  return (
    <span data-testid="authenticated-child">
      {query.data?.designs[0]?.title ?? "pending"}
    </span>
  );
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let client: QueryClient | undefined;
let localStorageControl:
  | ReturnType<typeof installMutableLocalStorage>
  | undefined;
let signedOutRead: ReturnType<typeof deferred<Response>> | undefined;

async function settleMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function waitUntil(predicate: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return true;
    await settleMicrotasks();
  }
  return predicate();
}

afterEach(async () => {
  signedOutRead?.resolve(
    new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  if (root) await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  await clearActionQueryCache().catch(() => {});
  setActionQueryCacheStorage(undefined);
  localStorageControl?.restore();
  localStorageControl = undefined;
  root = undefined;
  container = undefined;
  client = undefined;
  signedOutRead = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("separates epoch invalidation from peer sign-out in the mounted gate", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorageControl = installMutableLocalStorage();
  const { storage } = memoryStorage();
  setActionQueryCacheStorage(storage);
  signedOutRead = deferred<Response>();
  const fetch = stubFetch({
    onSession: (request) =>
      request === 1 ? sessionResponse(ALICE) : signedOutRead!.promise,
    onAction: () => designsResponse("Alice private result"),
  });

  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client!}>
        <ActionQueryCacheGate>
          <SessionContentGate>
            <AuthenticatedData />
          </SessionContentGate>
        </ActionQueryCacheGate>
      </QueryClientProvider>,
    );
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  const initialReady = await waitUntil(
    () =>
      fetch.sessionCount() === 1 &&
      client!.getQueryData<Designs>(ACTION_KEY)?.designs[0]?.title ===
        "Alice private result" &&
      container.querySelector('[data-testid="authenticated-child"]')
        ?.textContent === "Alice private result",
  );
  expect(
    initialReady,
    JSON.stringify({
      calls: fetch.calls,
      sessionCount: fetch.sessionCount(),
      actionCount: fetch.actionCount(),
      query: client.getQueryData(ACTION_KEY),
      status: container.querySelector('[data-testid="session-status"]')
        ?.textContent,
      html: container.innerHTML,
    }),
  ).toBe(true);
  expect(
    container.querySelector('[data-testid="authenticated-child"]')?.textContent,
  ).toBe("Alice private result");
  expect(
    container.querySelector('[data-testid="session-status"]')?.textContent,
  ).toBe("authenticated");
  const sameScopeData = client.getQueryData(ACTION_KEY);
  const priorEpoch = localStorageControl.values.get(EPOCH_KEY)!;

  localStorageControl.values.set(EPOCH_KEY, "epoch-written-by-peer");
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: EPOCH_KEY,
        oldValue: priorEpoch,
        newValue: "epoch-written-by-peer",
      }),
    );
    await Promise.resolve();
  });
  expect(fetch.sessionCount()).toBe(1);
  expect(fetch.actionCount()).toBe(1);
  expect(client.getQueryData(ACTION_KEY)).toBe(sameScopeData);
  expect(
    container.querySelector('[data-testid="authenticated-child"]')?.textContent,
  ).toBe("Alice private result");
  expect(
    container.querySelector('[data-testid="session-status"]')?.textContent,
  ).toBe("authenticated");

  localStorageControl.values.set(SESSION_INVALIDATION_KEY, "peer-sign-out");
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: SESSION_INVALIDATION_KEY,
        newValue: "peer-sign-out",
      }),
    );
    await Promise.resolve();
  });
  expect(fetch.sessionCount()).toBe(2);
  expect(fetch.actionCount()).toBe(1);
  expect(client.getQueryData(ACTION_KEY)).toBe(sameScopeData);
  expect(
    container.querySelector('[data-testid="authenticated-child"]')?.textContent,
  ).toBe("Alice private result");
  expect(
    container.querySelector('[data-testid="session-status"]')?.textContent,
  ).toBe("authenticated");

  await act(async () => {
    signedOutRead!.resolve(
      new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(container.querySelector('[data-testid="signed-out"]')).not.toBeNull();
  expect(
    container.querySelector('[data-testid="authenticated-child"]'),
  ).toBeNull();
  expect(container.querySelector('[data-testid="session-status"]')).toBeNull();
  expect(
    await waitUntil(
      () =>
        client!.getQueryCache().findAll({ queryKey: ["action"] }).length === 0,
    ),
  ).toBe(true);
  expect(client.getQueryData(ACTION_KEY)).toBeUndefined();
  expect(fetch.actionCount()).toBe(1);
});
