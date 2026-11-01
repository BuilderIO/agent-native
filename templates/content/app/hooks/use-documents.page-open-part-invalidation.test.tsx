// @vitest-environment happy-dom

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A collection's page answers its table's first reads along with the page.
// A change to one of those parts while the read is out (a row added, the
// view's filter saved) invalidates that part's key alone: the page itself is
// unchanged, so the read still owns its answer. That part of the answer
// predates the change, so it must not be put where the table looks for it.

const server = vi.hoisted(() => ({
  held: [] as Array<(value: unknown) => void>,
}));

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  // The session these reads were sent as is the one the tab accepts.
  sessionReadIdentityStatus: () => "current",
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
  callAction: (name: string) => {
    if (name !== "get-page-open-read") return Promise.resolve(null);
    return new Promise((resolve) => server.held.push(resolve));
  },
}));

import { openingDatabaseQueryKey } from "../lib/page-open-collection";
import { claimPageOpenRead } from "../lib/page-open-reads";
import { startPageOpenDocumentReads } from "./use-documents";

const tableQuery = {
  search: "",
  filters: [],
  sorts: [],
  filterMode: "and" as const,
};
const parts: Array<[string, QueryKey]> = [
  ["the collection", openingDatabaseQueryKey("page-1")],
  [
    "the personal view",
    ["action", "get-content-database-personal-view", { databaseId: "db-1" }],
  ],
  [
    "the first rows",
    [
      "action",
      "query-content-database-items",
      { documentId: "page-1", limit: 100, tableQuery },
    ],
  ],
];

// The answer, read before the change it is released after.
const answer = {
  document: { id: "page-1", title: "Roadmap", canEdit: true },
  collection: {
    database: { read: "before the change", items: [], properties: [] },
    personalView: {
      databaseId: "db-1",
      overrides: null,
      read: "before the change",
    },
    rows: { tableQuery, page: { read: "before the change", items: [] } },
  },
};

describe("a collection part invalidated while the page-open read is out", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    server.held = [];
    queryClient = new QueryClient();
  });

  afterEach(() => queryClient.clear());

  async function release() {
    for (const resolve of server.held) resolve(answer);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it.each(parts)(
    "keeps %s's older data, still invalidated, for the table to read again",
    async (_part, queryKey) => {
      // A previous visit left this part cached.
      queryClient.setQueryData(
        queryKey,
        { read: "on a previous visit" },
        { updatedAt: Date.now() - 60_000 },
      );
      startPageOpenDocumentReads(queryClient, "page-1");
      expect(server.held).toHaveLength(1);

      await queryClient.invalidateQueries({ queryKey, exact: true });
      await release();

      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      expect(query?.state.data).toEqual({ read: "on a previous visit" });
      expect(query?.state.isInvalidated).toBe(true);
      expect(claimPageOpenRead(queryClient, queryKey).adoption).toBe("none");
    },
  );

  it.each(parts)(
    "does not seed %s when its key was invalidated before anything cached it",
    async (_part, queryKey) => {
      startPageOpenDocumentReads(queryClient, "page-1");
      expect(server.held).toHaveLength(1);

      // Nothing holds this key yet, so the cache sees no invalidation.
      await queryClient.invalidateQueries({ queryKey: queryKey.slice(0, 2) });
      await release();

      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(claimPageOpenRead(queryClient, queryKey).adoption).toBe("none");
    },
  );

  it("still seeds the parts nothing invalidated", async () => {
    startPageOpenDocumentReads(queryClient, "page-1");
    const invalidatedPart = openingDatabaseQueryKey("page-1");
    const otherParts = parts.slice(1).map(([, key]) => key);

    await queryClient.invalidateQueries({
      queryKey: invalidatedPart,
      exact: true,
    });
    await release();

    expect(queryClient.getQueryData(invalidatedPart)).toBeUndefined();
    for (const queryKey of otherParts) {
      expect(queryClient.getQueryData(queryKey)).toMatchObject({
        read: "before the change",
      });
      expect(claimPageOpenRead(queryClient, queryKey).adoption).toBe("fresh");
    }
  });
});
