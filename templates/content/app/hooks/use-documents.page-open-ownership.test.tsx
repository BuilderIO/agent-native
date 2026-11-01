// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A page-open read in flight while the tab changes account or organization.
// Its answer belongs to the identity it was sent for, so once the cache is
// bound to another one, none of it may land where the new identity's table
// looks for its collection.

const server = vi.hoisted(() => ({
  calls: [] as Array<{
    name: string;
    params: Record<string, unknown>;
    signal: AbortSignal | undefined;
  }>,
  held: [] as Array<(value: unknown) => void>,
}));

const session = vi.hoisted(() => {
  type Answer = "pending" | "first-read" | "replaced";
  const listeners = new Set<() => void>();
  let answer: Answer = "first-read";
  return {
    get: () => answer,
    set(next: Answer) {
      answer = next;
      for (const listener of [...listeners]) listener();
    },
    reset() {
      answer = "first-read";
      listeners.clear();
    },
    listeners,
  };
});

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  firstSessionReadAnswer: () => session.get(),
  subscribeFirstSessionReadAnswer: (listener: () => void) => {
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  },
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  isOpenAiMcpAppHost: () => false,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => false,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  // The page-open read is held until the test releases it.
  callAction: (
    name: string,
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => {
    server.calls.push({ name, params, signal: options?.signal });
    if (name !== "get-page-open-read") return Promise.resolve(null);
    return new Promise((resolve) => server.held.push(resolve));
  },
}));

import {
  actionQueryCacheScope,
  bindActionQueryCache,
  clearActionQueryCache,
  setActionQueryCacheStorage,
  type ActionQueryCacheStorage,
} from "@agent-native/core/client/action-query-cache";

import { openingDatabaseQueryKey } from "../lib/page-open-collection";
import { startPageOpenDocumentReads } from "./use-documents";

const tableQuery = {
  search: "",
  filters: [],
  sorts: [],
  filterMode: "and" as const,
};
const collectionKeys = [
  openingDatabaseQueryKey("page-1"),
  ["action", "get-content-database-personal-view", { databaseId: "db-1" }],
  [
    "action",
    "query-content-database-items",
    { documentId: "page-1", limit: 100, tableQuery },
  ],
];

// The collection page as account A reads it.
const answerForA = {
  document: { id: "page-1", title: "A's collection", canEdit: true },
  collection: {
    database: { owner: "a", items: [{ id: "a-row" }], properties: [] },
    personalView: { databaseId: "db-1", overrides: null, owner: "a" },
    rows: { tableQuery, page: { owner: "a", items: [{ id: "a-row" }] } },
  },
};

type PersistedClient = Parameters<ActionQueryCacheStorage["set"]>[1];

function memoryStorage(): ActionQueryCacheStorage {
  const records = new Map<string, PersistedClient>();
  return {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => records.clear(),
  };
}

const scope = (user: string, orgId: string) =>
  actionQueryCacheScope(
    { email: `${user}@example.test`, userId: user, orgId },
    "",
  );

describe("a page-open read answered after the tab changed identity", () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    server.calls = [];
    server.held = [];
    session.reset();
    setActionQueryCacheStorage(memoryStorage());
    queryClient = new QueryClient();
    await bindActionQueryCache(queryClient, scope("a", "org-1"), {
      trustPrebindResults: true,
    });
  });

  afterEach(async () => {
    queryClient.clear();
    await clearActionQueryCache();
    setActionQueryCacheStorage(undefined);
  });

  it.each([
    [
      "account",
      () => {
        session.set("replaced");
        return scope("b", "org-1");
      },
    ],
    ["organization", () => scope("a", "org-2")],
  ])(
    "never fills the new %s's collection cache",
    async (_identity, switchIdentity) => {
      // An ordinary in-app open of the collection page, as A.
      startPageOpenDocumentReads(queryClient, "page-1");
      expect(server.held).toHaveLength(1);

      // The switch drops the old identity's action results and binds anew.
      const next = switchIdentity();
      queryClient.removeQueries({ queryKey: ["action"] });
      await bindActionQueryCache(queryClient, next);

      // A's answer arrives anyway.
      for (const release of server.held) release(answerForA);
      await new Promise((resolve) => setTimeout(resolve, 20));

      for (const queryKey of collectionKeys) {
        expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      }
      expect(
        JSON.stringify(
          queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.state.data ?? null),
        ),
      ).not.toContain('"a"');
    },
  );

  it("cancels the request when the page read is dropped", async () => {
    startPageOpenDocumentReads(queryClient, "page-1");
    const pageRead = server.calls.find(
      (call) => call.name === "get-page-open-read",
    );

    queryClient.removeQueries({ queryKey: ["action"] });

    expect(pageRead?.signal?.aborted).toBe(true);
  });
});
