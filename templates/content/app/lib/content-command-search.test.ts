import { describe, expect, it } from "vitest";

import {
  COMMAND_SEARCH_PAGE_LIMIT,
  contentCommandDocumentPath,
  groupContentCommandSearchResults,
  mergeContentCommandSearchPage,
  type CommandSearchDocumentResult,
  type CommandSearchDocumentsResponse,
} from "./content-command-search";

function document(
  id: string,
  title: string,
  snippet = "",
): CommandSearchDocumentResult {
  return {
    id,
    parentId: null,
    title,
    icon: null,
    snippet,
    contentLength: snippet.length,
    hideFromSearch: false,
    updatedAt: "2026-06-30T00:00:00.000Z",
  };
}

describe("content command search", () => {
  it("groups documents, databases, and local-file results", () => {
    const groups = groupContentCommandSearchResults({
      query: "launch",
      documents: [
        document("doc-1", "Launch notes", "Body snippet"),
        document(
          "local-file:ZG9jcy9sYXVuY2gubWQ",
          "Local launch note",
          "Local",
        ),
        document("local-folder:docs", "Docs folder", "Folder"),
      ],
      databases: [
        {
          databaseId: "db-1",
          documentId: "db-doc-1",
          spaceId: null,
          title: "Launch calendar",
          description: "",
        },
        {
          databaseId: "db-2",
          documentId: "db-doc-2",
          spaceId: null,
          title: "Ideas",
          description: "",
        },
      ],
    });

    expect(groups.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(groups.localFiles.map((doc) => doc.id)).toEqual([
      "local-file:ZG9jcy9sYXVuY2gubWQ",
      "local-folder:docs",
    ]);
    expect(groups.databases.map((database) => database.databaseId)).toEqual([
      "db-1",
    ]);
  });

  it("uses document page routes for selectable results", () => {
    expect(contentCommandDocumentPath("doc-1")).toBe("/page/doc-1");
    expect(contentCommandDocumentPath("local-file:ZG9jcy9sYXVuY2gubWQ")).toBe(
      "/page/local-file:ZG9jcy9sYXVuY2gubWQ",
    );
    expect(contentCommandDocumentPath("local-file:docs/launch.md")).toBe(
      "/page/local-file:docs/launch.md",
    );
  });

  it("does not duplicate database-backed pages as document results", () => {
    const groups = groupContentCommandSearchResults({
      query: "launch",
      documents: [
        document("doc-1", "Launch notes"),
        document("db-doc-1", "Launch calendar"),
      ],
      databases: [
        {
          databaseId: "db-1",
          documentId: "db-doc-1",
          spaceId: null,
          title: "Launch calendar",
          description: "",
        },
      ],
    });

    expect(groups.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(groups.databases.map((database) => database.documentId)).toEqual([
      "db-doc-1",
    ]);
  });

  it("excludes hidden documents from command search groups", () => {
    const hiddenDocument = document("hidden-doc", "Hidden launch note");
    hiddenDocument.hideFromSearch = true;
    const hiddenLocalFile = document(
      "local-file:aGlkZGVuLmxhdW5jaC5tZA",
      "Hidden local launch note",
    );
    hiddenLocalFile.hideFromSearch = true;

    const groups = groupContentCommandSearchResults({
      query: "launch",
      documents: [
        document("doc-1", "Launch notes"),
        hiddenDocument,
        hiddenLocalFile,
      ],
      databases: [],
    });

    expect(groups.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(groups.localFiles).toEqual([]);
  });
});

function page(
  documents: CommandSearchDocumentResult[],
  pagination: Partial<CommandSearchDocumentsResponse["pagination"]> = {},
): CommandSearchDocumentsResponse {
  return {
    documents,
    pagination: {
      offset: 0,
      limit: COMMAND_SEARCH_PAGE_LIMIT,
      totalItems: documents.length,
      returnedItems: documents.length,
      hasMore: false,
      nextOffset: null,
      ...pagination,
    },
  };
}

describe("mergeContentCommandSearchPage", () => {
  it("follows nextOffset while the visible budget is unfilled", () => {
    const first = mergeContentCommandSearchPage(
      { nextOffset: 0, documents: [] },
      page([document("doc-1", "Launch one")], {
        offset: 0,
        hasMore: true,
        nextOffset: 8,
      }),
    );

    expect(first.nextOffset).toBe(8);
    expect(first.documents.map((doc) => doc.id)).toEqual(["doc-1"]);

    const second = mergeContentCommandSearchPage(
      first,
      page(
        Array.from({ length: 3 }, (_, index) =>
          document(`doc-${index + 2}`, `Launch ${index + 2}`),
        ),
        { offset: 8, hasMore: true, nextOffset: 16 },
      ),
    );

    expect(second.nextOffset).toBe(16);
    expect(second.documents).toHaveLength(4);
  });

  it("follows one more page at exactly the budget, then stops past it", () => {
    const atBudget = mergeContentCommandSearchPage(
      { nextOffset: 0, documents: [] },
      page(
        Array.from({ length: COMMAND_SEARCH_PAGE_LIMIT }, (_, index) =>
          document(`doc-${index + 1}`, `Launch ${index + 1}`),
        ),
        { offset: 0, hasMore: true, nextOffset: 8 },
      ),
    );

    expect(atBudget.nextOffset).toBe(8);

    const pastBudget = mergeContentCommandSearchPage(
      atBudget,
      page(
        Array.from({ length: 3 }, (_, index) =>
          document(`doc-${index + 9}`, `Launch ${index + 9}`),
        ),
        { offset: 8, hasMore: true, nextOffset: 16 },
      ),
    );

    expect(pastBudget.nextOffset).toBe(8);
    expect(pastBudget.documents).toHaveLength(COMMAND_SEARCH_PAGE_LIMIT + 3);
  });

  it("accumulates every match across pages for a multi-page result set", () => {
    const first = mergeContentCommandSearchPage(
      { nextOffset: 0, documents: [] },
      page(
        Array.from({ length: COMMAND_SEARCH_PAGE_LIMIT }, (_, index) =>
          document(`doc-${index + 1}`, `Paging ${index + 1}`),
        ),
        { offset: 0, hasMore: true, nextOffset: 8, totalItems: 10 },
      ),
    );
    const second = mergeContentCommandSearchPage(
      first,
      page([document("doc-9", "Paging 9"), document("doc-10", "Paging 10")], {
        offset: 8,
        hasMore: false,
        nextOffset: null,
        totalItems: 10,
      }),
    );

    expect(second.nextOffset).toBe(8);
    expect(second.documents).toHaveLength(10);
  });

  it("stops paging when the server has no more pages", () => {
    const merged = mergeContentCommandSearchPage(
      { nextOffset: 0, documents: [] },
      page([document("doc-1", "Launch one")], {
        offset: 0,
        hasMore: false,
        nextOffset: null,
      }),
    );

    expect(merged.nextOffset).toBe(0);
    expect(merged.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
  });

  it("keeps paging past hidden rows that do not fill the budget", () => {
    const hiddenDocument = document("hidden-doc", "Hidden launch note");
    hiddenDocument.hideFromSearch = true;

    const merged = mergeContentCommandSearchPage(
      { nextOffset: 0, documents: [] },
      page([hiddenDocument], { offset: 0, hasMore: true, nextOffset: 8 }),
    );

    expect(merged.nextOffset).toBe(8);
    expect(merged.documents.map((doc) => doc.id)).toEqual(["hidden-doc"]);
  });

  it("does not accumulate the same document twice", () => {
    const first = mergeContentCommandSearchPage(
      { nextOffset: 0, documents: [] },
      page([document("doc-1", "Launch one")], {
        offset: 0,
        hasMore: true,
        nextOffset: 8,
      }),
    );
    const second = mergeContentCommandSearchPage(
      first,
      page([document("doc-1", "Launch one")], {
        offset: 0,
        hasMore: true,
        nextOffset: 8,
      }),
    );

    expect(second.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(second.nextOffset).toBe(8);
  });
});
