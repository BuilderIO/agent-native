// @vitest-environment happy-dom

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A collection's page answers its table's first reads along with the page,
// and the table adopts them as its own reads while they are fresh. Like the
// page, each part is as old as the request that read it, not as old as the
// moment its answer was put in the cache: a slow answer leaves the table
// less of the freshness window, never a new one, and its cached copy is
// dated from the request.

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
import {
  claimPageOpenRead,
  PAGE_OPEN_READ_TTL_MS,
} from "../lib/page-open-reads";
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
const answer = {
  document: { id: "page-1", title: "Roadmap", canEdit: true },
  collection: {
    database: { items: [], properties: [] },
    personalView: { databaseId: "db-1", overrides: null },
    rows: { tableQuery, page: { items: [] } },
  },
};

describe("a collection part seeded late in the page-open read's life", () => {
  let queryClient: QueryClient;
  let requestAge = 0;
  let sentAt = 0;

  beforeEach(() => {
    server.held = [];
    queryClient = new QueryClient();
    sentAt = Date.now();
    requestAge = 0;
    vi.spyOn(Date, "now").mockImplementation(() => sentAt + requestAge);
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  // The read goes out, and answers 9 s later.
  async function answerAtNineSeconds() {
    startPageOpenDocumentReads(queryClient, "page-1");
    expect(server.held).toHaveLength(1);
    requestAge = 9_000;
    for (const resolve of server.held) resolve(answer);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it.each(parts)(
    "is not adopted once the request is older than the window: %s",
    async (_part, queryKey) => {
      await answerAtNineSeconds();
      expect(queryClient.getQueryData(queryKey)).toBeDefined();

      requestAge = PAGE_OPEN_READ_TTL_MS + 500;

      expect(claimPageOpenRead(queryClient, queryKey).adoption).toBe("none");
    },
  );

  it("dates every part from the request, not from when its answer landed", async () => {
    await answerAtNineSeconds();

    for (const [, queryKey] of parts) {
      expect(queryClient.getQueryState(queryKey)?.dataUpdatedAt).toBe(sentAt);
    }
  });

  it("is adopted while the request is still inside the window", async () => {
    await answerAtNineSeconds();
    requestAge = PAGE_OPEN_READ_TTL_MS - 500;

    for (const [, queryKey] of parts) {
      expect(claimPageOpenRead(queryClient, queryKey).adoption).toBe("fresh");
    }
  });
});
