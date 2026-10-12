import "./action-query-cache.test-fixtures.js";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({
  setSentryUser: vi.fn(),
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
}));

import type { PersistedClient } from "@tanstack/query-persist-client-core";

import {
  ActionQueryCacheGate,
  actionQueryCacheScope,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "./action-query-cache.js";
import { clientBuildId } from "./build-compatibility.js";
import { useActionQuery } from "./use-action.js";
import {
  isSessionFromFirstRead,
  recheckSessionAfterUnauthorized,
  useSession,
} from "./use-session.js";

const USER_A = {
  email: "first-read@example.test",
  userId: "real-first-read-user-a",
  orgId: "org-a",
};
const USER_B = {
  email: "retry-read@example.test",
  userId: "real-retry-read-user-b",
  orgId: "org-b",
};
const SCOPE_A = actionQueryCacheScope(USER_A, clientBuildId());
type Payload = { owner: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function sessionResponse(session: typeof USER_A): Response {
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function actionResponse(owner: string): Response {
  return new Response(JSON.stringify({ owner }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-Browser-Persist": "allow",
    },
  });
}

const roots: Array<{
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}> = [];

function OwnerProbe() {
  const query = useActionQuery<Payload>("list-designs" as never, undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  return query.data ? (
    <span data-testid="owner">{query.data.owner}</span>
  ) : null;
}

function SessionShell({ children }: { children: ReactNode }) {
  const { isLoading } = useSession();
  return (
    <div
      data-testid="session-shell"
      style={{ display: isLoading ? "none" : "contents" }}
    >
      {children}
    </div>
  );
}

function SessionCommitProbe({
  commits,
  container,
}: {
  commits: Array<{
    status: string;
    userId: string | null;
    visibleOwner: string | null;
  }>;
  container: HTMLDivElement;
}) {
  const { session, status } = useSession();
  useEffect(() => {
    commits.push({
      status,
      userId: session?.userId ?? null,
      visibleOwner:
        container.querySelector('[data-testid="owner"]')?.textContent ?? null,
    });
  }, [commits, container, session?.userId, status]);
  return null;
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

it("uses the real first session read for preload trust and rejects a later invalidated read", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const firstSessionRead = deferred<Response>();
  const secondSessionRead = deferred<Response>();
  const secondActionRead = deferred<Response>();
  const { records, reads, storage } = (() => {
    const records = new Map<string, PersistedClient>();
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
  })();
  setActionQueryCacheStorage(storage);

  let sessionCalls = 0;
  let actionCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("auth/session")) {
      sessionCalls += 1;
      return sessionCalls === 1
        ? firstSessionRead.promise
        : secondSessionRead.promise;
    }
    actionCalls += 1;
    return actionCalls === 1
      ? actionResponse("prebind-owner-a")
      : secondActionRead.promise;
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container, client });
  const commits: Array<{
    status: string;
    userId: string | null;
    visibleOwner: string | null;
  }> = [];

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SessionCommitProbe commits={commits} container={container} />
        <ActionQueryCacheGate>
          <SessionShell>
            <OwnerProbe />
          </SessionShell>
        </ActionQueryCacheGate>
      </QueryClientProvider>,
    );
  });

  await expect
    .poll(() => container.querySelector('[data-testid="owner"]')?.textContent)
    .toBe("prebind-owner-a");
  expect(sessionCalls).toBe(1);
  expect(actionCalls).toBe(1);
  expect(isSessionFromFirstRead()).toBe(false);

  firstSessionRead.resolve(sessionResponse(USER_A));
  await expect.poll(() => isSessionFromFirstRead()).toBe(true);
  await expect.poll(() => reads.includes(SCOPE_A)).toBe(true);
  await expect
    .poll(() => container.querySelector('[data-testid="owner"]')?.textContent)
    .toBe("prebind-owner-a");
  expect(actionCalls).toBe(1);
  expect(
    commits.some(
      (commit) =>
        commit.status === "authenticated" &&
        commit.userId === USER_A.userId &&
        commit.visibleOwner === "prebind-owner-a",
    ),
  ).toBe(true);

  recheckSessionAfterUnauthorized();
  await expect.poll(() => sessionCalls).toBe(2);
  expect(isSessionFromFirstRead()).toBe(false);
  secondSessionRead.resolve(sessionResponse(USER_B));

  await expect.poll(() => actionCalls).toBe(2);
  await expect
    .poll(() =>
      commits.some(
        (commit) =>
          commit.status === "authenticated" &&
          commit.userId === USER_B.userId &&
          commit.visibleOwner === null,
      ),
    )
    .toBe(true);
  expect(
    container.querySelector('[data-testid="owner"]')?.textContent,
  ).toBeUndefined();

  secondActionRead.resolve(actionResponse("verified-owner-b"));
  await expect
    .poll(() => container.querySelector('[data-testid="owner"]')?.textContent)
    .toBe("verified-owner-b");
  expect(actionCalls).toBe(2);
  expect(
    commits.some(
      (commit) =>
        commit.status === "authenticated" &&
        commit.userId === USER_B.userId &&
        commit.visibleOwner === "prebind-owner-a",
    ),
  ).toBe(false);
});
