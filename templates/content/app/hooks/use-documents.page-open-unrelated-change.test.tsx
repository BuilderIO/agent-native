// @vitest-environment happy-dom

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sync asks Content's rule whether a change reaches each query. A change it
// hears while a page's open read is out is asked of the page's read the same
// way, live or from sync's log once a read the head sent lands: a comment on
// another page leaves the read standing, so the page is read once. A change
// to this page, or one the rule can't tell is elsewhere, still has the page
// read again.

const server = vi.hoisted(() => ({
  calls: [] as string[],
  held: [] as Array<(value: unknown) => void>,
}));
// What sync has invalidated so far, by the version of the change behind it.
const syncLog = vi.hoisted(() => ({
  entries: [] as Array<{ version: number; filters: object }>,
}));

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  // The session these reads were sent as is the one the tab accepts.
  sessionReadIdentity: () => ({ generation: 0, transport: server }),
  sessionReadIdentityStatus: () => "current",
}));
vi.mock("@agent-native/core/client/use-db-sync", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-db-sync")
  >()),
  syncInvalidationsAfter: (_queryClient: object, cursor?: string) => {
    const readAt = cursor === undefined ? -1 : Number(cursor.split(".")[0]);
    return syncLog.entries
      .filter((entry) => entry.version > readAt)
      .map(({ filters }) => filters);
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
  callAction: (name: string) => {
    server.calls.push(name);
    if (name !== "get-page-open-read") return Promise.resolve(null);
    return new Promise((resolve) => server.held.push(resolve));
  },
}));

import { openingDatabaseQueryKey } from "../lib/page-open-collection";
import {
  adoptPageOpenRead,
  claimPageOpenRead,
  isPageOpenRead,
} from "../lib/page-open-reads";
import { contentActionInvalidatePredicate } from "./content-action-refresh";
import { startPageOpenDocumentReads } from "./use-documents";

const pageKey = ["action", "get-document", { id: "page-1" }];

// The requests that read the page, leaving out the comments and suggestions
// an open reads beside it.
const pageReads = () =>
  server.calls.filter(
    (name) => name === "get-page-open-read" || name === "get-document",
  );

// A change sync heard, made by an action that names the page it changed.
const change = (key: string, documentId: string) => ({
  source: "action",
  key,
  resourceType: "document",
  resourceId: documentId,
});
type Change = ReturnType<typeof change>;

// The filters sync invalidates with for a batch of changes: Content's rule,
// asked of each query, as `useDbSync` passes it.
function syncFilters(queryClient: QueryClient, changes: Change[]) {
  const rule = contentActionInvalidatePredicate("/home", (query) =>
    isPageOpenRead(queryClient, query.queryKey),
  );
  return {
    predicate: (query: { queryKey: QueryKey; isActive?: () => boolean }) =>
      rule(query, changes),
  };
}

describe("a change sync hears while the app's page read is out", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    server.calls = [];
    server.held = [];
    syncLog.entries = [];
    queryClient = new QueryClient();
  });

  afterEach(() => queryClient.clear());

  async function release(answer: object) {
    for (const resolve of server.held) resolve(answer);
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(pageKey)?.status).toBe("success"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function hear(changes: Change[]) {
    await queryClient.invalidateQueries(syncFilters(queryClient, changes), {
      cancelRefetch: false,
    });
  }

  const page = { document: { id: "page-1", title: "Plan", canEdit: true } };

  it("leaves the read standing for a comment on another page, so the page is read once", async () => {
    startPageOpenDocumentReads(queryClient, "page-1");
    await hear([change("add-comment", "page-2")]);
    await release(page);

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(false);
    expect(adoptPageOpenRead(queryClient, pageKey)).toBe("fresh");
    expect(pageReads()).toEqual(["get-page-open-read"]);
  });

  it.each([
    ["a comment on this page", change("add-comment", "page-1")],
    ["an edit to this page", change("edit-document", "page-1")],
    // A rollup on this page can read another page's body.
    ["an edit to another page", change("edit-document", "page-2")],
    // The page's breadcrumb or a relation can show another page's title.
    ["a rename of another page", change("update-document", "page-2")],
  ])("has the page read again for %s", async (_change, heard) => {
    startPageOpenDocumentReads(queryClient, "page-1");
    await hear([heard]);
    await release(page);

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(true);
    expect(adoptPageOpenRead(queryClient, pageKey)).toBe("none");
  });

  // Rows carry their open-comment counts, so a comment on a row changes the
  // rows its collection's page reads. The rule judges the rows by whether
  // their collection's page is open, and it isn't yet.
  it("still leaves a collection part to its own read for a comment on one of its rows", async () => {
    const tableQuery = {
      search: "",
      filters: [],
      sorts: [],
      filterMode: "and" as const,
    };
    const rowsKey = [
      "action",
      "query-content-database-items",
      { documentId: "page-1", limit: 100, tableQuery },
    ];
    // A previous visit left the rows cached.
    queryClient.setQueryData(
      rowsKey,
      { read: "on a previous visit" },
      { updatedAt: Date.now() - 60_000 },
    );
    startPageOpenDocumentReads(queryClient, "page-1");
    await hear([change("add-comment", "row-2")]);
    await release({
      ...page,
      collection: {
        database: { read: "before the change", items: [], properties: [] },
        rows: { tableQuery, page: { read: "before the change", items: [] } },
      },
    });

    expect(adoptPageOpenRead(queryClient, pageKey)).toBe("fresh");
    for (const partKey of [openingDatabaseQueryKey("page-1"), rowsKey]) {
      expect(queryClient.getQueryData(partKey)).not.toEqual(
        expect.objectContaining({ read: "before the change" }),
      );
      expect(claimPageOpenRead(queryClient, partKey).adoption).toBe("none");
    }
  });
});

describe("a change sync logged before a read the head sent lands", () => {
  let queryClient: QueryClient;
  let answerHeadRead: (syncCursor: string) => void;

  beforeEach(() => {
    server.calls = [];
    server.held = [];
    syncLog.entries = [];
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolve: (answer: { ok: true; value: unknown }) => void = () => {};
    const answer = new Promise<{ ok: true; value: unknown }>((done) => {
      resolve = done;
    });
    answerHeadRead = (syncCursor) =>
      resolve({
        ok: true,
        value: {
          document: { id: "page-1", title: "Plan", canEdit: true },
          syncCursor,
        },
      });
    window.__contentStartupPageRead = {
      id: "page-1",
      databaseId: null,
      databaseDocumentId: null,
      startedAt: Date.now() - 500,
      transport: globalThis.fetch,
      answer,
    };
  });

  afterEach(() => {
    delete window.__contentStartupPageRead;
    queryClient.clear();
  });

  async function landed() {
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(pageKey)?.status).toBe("success"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function logged(changes: Change[]) {
    syncLog.entries.push({
      version: 5,
      filters: syncFilters(queryClient, changes),
    });
  }

  it("leaves the read standing for a comment on another page", async () => {
    logged([change("add-comment", "page-2")]);
    startPageOpenDocumentReads(queryClient, "page-1", {}, { fromLoad: true });
    answerHeadRead("4.e4");
    await landed();

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(false);
    expect(adoptPageOpenRead(queryClient, pageKey)).toBe("fresh");
    expect(pageReads()).toEqual([]);
  });

  it.each([
    ["a comment on this page", change("add-comment", "page-1")],
    ["an edit to another page", change("edit-document", "page-2")],
  ])("has the page read again for %s", async (_change, heard) => {
    logged([heard]);
    startPageOpenDocumentReads(queryClient, "page-1", {}, { fromLoad: true });
    answerHeadRead("4.e4");
    await landed();

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(true);
    expect(adoptPageOpenRead(queryClient, pageKey)).toBe("none");
  });
});
