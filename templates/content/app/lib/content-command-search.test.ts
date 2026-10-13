import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  buildDocumentSpaceRootIndex,
  contentCommandDocumentPath,
  documentDisplayType,
  documentEligibleForInstantSearch,
  documentMatchesModifiedAfter,
  documentMatchesSelectedScope,
  documentPassesInstantSearchFilters,
  documentSpaceRootIds,
  documentToInstantSearchResult,
  excludeAlreadyShownDocuments,
  mergeInstantAndServerResults,
  searchHighlightParts,
  type CommandSearchDocumentResult,
  type InstantSearchFilters,
} from "./content-command-search";

function makeDocument(overrides: Partial<Document> & { id: string }): Document {
  return {
    parentId: null,
    title: "Untitled",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<CommandSearchDocumentResult> & { id: string },
): CommandSearchDocumentResult {
  return {
    parentId: null,
    parentTitle: null,
    description: "",
    documentType: "page",
    sourceKind: null,
    sourceUpdatedAt: null,
    title: "Untitled",
    icon: null,
    snippet: "",
    contentLength: 0,
    hideFromSearch: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("content command search", () => {
  it("preserves canonical page and local file routes", () => {
    expect(contentCommandDocumentPath("doc-1")).toBe("/page/doc-1");
    expect(contentCommandDocumentPath("local-file:docs/launch.md")).toBe(
      "/page/local-file:docs/launch.md",
    );
  });
  it("highlights literal repeated matches without interpreting markup or regex", () => {
    expect(searchHighlightParts("<b>A.b a.B</b>", ["a.b"])).toEqual([
      { text: "<b>", match: false },
      { text: "A.b", match: true },
      { text: " ", match: false },
      { text: "a.B", match: true },
      { text: "</b>", match: false },
    ]);
    expect(searchHighlightParts("No match", [" "])).toEqual([
      { text: "No match", match: false },
    ]);
    expect(searchHighlightParts("No match", ["needle"])).toEqual([
      { text: "No match", match: false },
    ]);
  });

  it("highlights every needle without overlapping matches", () => {
    expect(
      searchHighlightParts("status hub report", ["hub", "status"]),
    ).toEqual([
      { text: "status", match: true },
      { text: " ", match: false },
      { text: "hub", match: true },
      { text: " report", match: false },
    ]);
    expect(searchHighlightParts("Atlas note notes", ["note"])).toEqual([
      { text: "Atlas ", match: false },
      { text: "note", match: true },
      { text: " ", match: false },
      { text: "note", match: true },
      { text: "s", match: false },
    ]);
    expect(searchHighlightParts("QA4600", [])).toEqual([
      { text: "QA4600", match: false },
    ]);
    expect(
      searchHighlightParts("Status Status", ["Status Hub", "status"]),
    ).toEqual([
      { text: "Status", match: true },
      { text: " ", match: false },
      { text: "Status", match: true },
    ]);
  });
});

describe("documentDisplayType", () => {
  it("is a database only when the document has an active database row", () => {
    expect(documentDisplayType({ database: undefined })).toBe("page");
    expect(
      documentDisplayType({
        database: {
          id: "db-1",
          documentId: "doc-1",
          title: "Tasks",
          viewConfig: { views: [], activeViewId: "" } as never,
          createdAt: "",
          updatedAt: "",
        },
      }),
    ).toBe("database");
  });
});

describe("documentEligibleForInstantSearch", () => {
  it("excludes documents hidden from search, matching search-documents' text-query clause", () => {
    expect(documentEligibleForInstantSearch({ hideFromSearch: false })).toBe(
      true,
    );
    expect(documentEligibleForInstantSearch({ hideFromSearch: true })).toBe(
      false,
    );
  });
});

describe("documentMatchesModifiedAfter", () => {
  it("passes without a boundary and compares timestamps inclusively otherwise", () => {
    expect(
      documentMatchesModifiedAfter(
        { updatedAt: "2020-01-01T00:00:00.000Z" },
        undefined,
      ),
    ).toBe(true);
    expect(
      documentMatchesModifiedAfter(
        { updatedAt: "2026-01-01T00:00:00.000Z" },
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      documentMatchesModifiedAfter(
        { updatedAt: "2025-01-01T00:00:00.000Z" },
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("buildDocumentSpaceRootIndex and documentMatchesSelectedScope", () => {
  it("resolves every document to its topmost loaded ancestor", () => {
    const documents = [
      makeDocument({ id: "root", parentId: null }),
      makeDocument({ id: "child", parentId: "root" }),
      makeDocument({ id: "grandchild", parentId: "child" }),
      makeDocument({ id: "other-root", parentId: null }),
      // Parent not present in the loaded list: treated as its own root.
      makeDocument({ id: "orphan", parentId: "missing" }),
    ];
    const index = buildDocumentSpaceRootIndex(documents);
    expect(index.get("grandchild")).toBe("root");
    expect(index.get("child")).toBe("root");
    expect(index.get("root")).toBe("root");
    expect(index.get("other-root")).toBe("other-root");
    expect(index.get("orphan")).toBe("orphan");
  });

  it("follows Files-collection membership for top-level pages, as list-documents returns them", () => {
    const membership = (databaseDocumentId: string) =>
      ({
        databaseId: `db-${databaseDocumentId}`,
        databaseDocumentId,
        databaseTitle: databaseDocumentId,
        position: 0,
        sourceId: null,
        systemRole: "files",
      }) as unknown as Document["databaseMembership"];
    const documents = [
      makeDocument({ id: "personal-files", parentId: null }),
      makeDocument({ id: "org-files", parentId: null }),
      makeDocument({
        id: "top-level-page",
        parentId: null,
        databaseMembership: membership("personal-files"),
      }),
      makeDocument({
        id: "nested-page",
        parentId: "top-level-page",
        databaseMembership: membership("personal-files"),
      }),
      makeDocument({
        id: "org-page",
        parentId: null,
        databaseMembership: membership("org-files"),
      }),
    ];
    const rootIndex = buildDocumentSpaceRootIndex(documents);
    const personal = documentSpaceRootIds({
      filesDocumentId: "personal-files",
      catalogDocumentId: "personal-catalog",
    });
    for (const documentId of ["top-level-page", "nested-page"]) {
      expect(
        documentMatchesSelectedScope({
          documentId,
          rootIndex,
          spaceRootIds: personal,
        }),
      ).toBe(true);
    }
    expect(
      documentMatchesSelectedScope({
        documentId: "org-page",
        rootIndex,
        spaceRootIds: personal,
      }),
    ).toBe(false);
  });

  it("breaks a parentId cycle instead of looping forever", () => {
    const documents = [
      makeDocument({ id: "a", parentId: "b" }),
      makeDocument({ id: "b", parentId: "a" }),
    ];
    const index = buildDocumentSpaceRootIndex(documents);
    expect(index.get("a")).toBeDefined();
    expect(index.get("b")).toBeDefined();
  });

  it("matches a document only when its root is a known space root", () => {
    const documents = [
      makeDocument({ id: "files-root", parentId: null }),
      makeDocument({ id: "page", parentId: "files-root" }),
      makeDocument({ id: "other-space-root", parentId: null }),
      makeDocument({ id: "other-page", parentId: "other-space-root" }),
    ];
    const rootIndex = buildDocumentSpaceRootIndex(documents);
    const spaceRootIds = documentSpaceRootIds({
      filesDocumentId: "files-root",
      catalogDocumentId: "catalog-root",
    });
    expect(
      documentMatchesSelectedScope({
        documentId: "page",
        rootIndex,
        spaceRootIds,
      }),
    ).toBe(true);
    expect(
      documentMatchesSelectedScope({
        documentId: "files-root",
        rootIndex,
        spaceRootIds,
      }),
    ).toBe(true);
    expect(
      documentMatchesSelectedScope({
        documentId: "other-page",
        rootIndex,
        spaceRootIds,
      }),
    ).toBe(false);
  });
});

describe("documentPassesInstantSearchFilters", () => {
  const rootIndex = buildDocumentSpaceRootIndex([
    makeDocument({ id: "files-root", parentId: null }),
    makeDocument({ id: "page", parentId: "files-root" }),
  ]);
  const spaceRootIds = documentSpaceRootIds({
    filesDocumentId: "files-root",
    catalogDocumentId: "catalog-root",
  });
  const baseFilters: InstantSearchFilters = {
    searchingAll: false,
    spaceRootIds,
    rootIndex,
  };

  it("combines eligibility, type, date, and scope filters", () => {
    const eligible = makeDocument({
      id: "page",
      parentId: "files-root",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(documentPassesInstantSearchFilters(eligible, baseFilters)).toBe(
      true,
    );
    expect(
      documentPassesInstantSearchFilters(
        { ...eligible, hideFromSearch: true },
        baseFilters,
      ),
    ).toBe(false);
    expect(
      documentPassesInstantSearchFilters(eligible, {
        ...baseFilters,
        documentType: "database",
      }),
    ).toBe(false);
    expect(
      documentPassesInstantSearchFilters(eligible, {
        ...baseFilters,
        modifiedAfter: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("excludes a document outside the selected scope but allows it when searching all spaces", () => {
    const outsider = makeDocument({ id: "other-page", parentId: null });
    expect(documentPassesInstantSearchFilters(outsider, baseFilters)).toBe(
      false,
    );
    expect(
      documentPassesInstantSearchFilters(outsider, {
        ...baseFilters,
        searchingAll: true,
      }),
    ).toBe(true);
  });
});

describe("documentToInstantSearchResult", () => {
  it("leaves parentTitle and snippet for server enrichment", () => {
    const result = documentToInstantSearchResult(
      makeDocument({
        id: "doc-1",
        title: "Task Priorities",
        parentId: "parent-1",
        description: "A durable projection",
      }),
    );
    expect(result).toMatchObject({
      id: "doc-1",
      title: "Task Priorities",
      parentId: "parent-1",
      parentTitle: null,
      snippet: "",
      documentType: "page",
      description: "A durable projection",
    });
  });
});

describe("mergeInstantAndServerResults", () => {
  it("adopts the server's order for items it returns and appends browser-only matches after, deduped by id", () => {
    const instant = [
      makeResult({ id: "b", title: "B (instant guess)" }),
      makeResult({ id: "a", title: "A (instant guess)" }),
      makeResult({ id: "fuzzy-only", title: "Fuzzy match" }),
    ];
    const server = [
      // The server's own order for the same tier — the opposite of the
      // instant lane's guess above. The merged list must converge on this.
      makeResult({ id: "a", title: "A", snippet: "server snippet" }),
      makeResult({ id: "b", title: "B" }),
      makeResult({ id: "c", title: "C" }),
    ];
    const merged = mergeInstantAndServerResults(instant, server);
    expect(merged.map((doc) => doc.id)).toEqual(["a", "b", "c", "fuzzy-only"]);
    expect(merged[0]).toMatchObject({ id: "a", snippet: "server snippet" });
  });

  it("keeps instant-only results when the server has not returned anything (yet, or ever)", () => {
    const instant = [makeResult({ id: "a", title: "A" })];
    expect(mergeInstantAndServerResults(instant, []).map((d) => d.id)).toEqual([
      "a",
    ]);
  });

  it("shows only the server's order once every instant match is also server-confirmed", () => {
    const instant = [
      makeResult({ id: "b", title: "B" }),
      makeResult({ id: "a", title: "A" }),
    ];
    const server = [
      makeResult({ id: "a", title: "A" }),
      makeResult({ id: "b", title: "B" }),
    ];
    expect(
      mergeInstantAndServerResults(instant, server).map((d) => d.id),
    ).toEqual(["a", "b"]);
  });
});

describe("excludeAlreadyShownDocuments", () => {
  it("filters out documents already shown on page one", () => {
    const documents = [
      makeResult({ id: "a" }),
      makeResult({ id: "b" }),
      makeResult({ id: "c" }),
    ];
    const filtered = excludeAlreadyShownDocuments(
      documents,
      new Set(["a", "c"]),
    );
    expect(filtered.map((d) => d.id)).toEqual(["b"]);
  });
});
