import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  buildDocumentTree,
  filterDocumentTreeDocuments,
  mergeDocumentIntoDocumentCache,
  mergeDocumentIntoListDocumentsCache,
} from "./use-documents";

function doc(id: string, parentId: string | null, position = 0): Document {
  return {
    id,
    parentId,
    position,
    title: id,
    content: "",
    icon: null,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

describe("buildDocumentTree", () => {
  it("keeps cyclic parent references renderable as roots", () => {
    const tree = buildDocumentTree([doc("a", "b"), doc("b", "a")]);

    expect(tree.map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("ignores duplicate document ids instead of creating self-recursive nodes", () => {
    const tree = buildDocumentTree([
      doc("a", null),
      doc("a", "a", 1),
      doc("b", "a"),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("a");
    expect(tree[0].children.map((node) => node.id)).toEqual(["b"]);
  });
});

describe("filterDocumentTreeDocuments", () => {
  it("keeps database pages but removes their row pages from the sidebar tree", () => {
    const database = {
      ...doc("database-page", null),
      database: {
        id: "database",
        documentId: "database-page",
        title: "Content calendar",
        viewConfig: {
          activeViewId: "default",
          views: [],
          sorts: [],
          filters: [],
          columnWidths: {},
        },
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    };
    const row = {
      ...doc("row-page", "database-page"),
      databaseMembership: {
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "Content calendar",
        position: 0,
      },
    };

    expect(
      filterDocumentTreeDocuments([database, row]).map((node) => node.id),
    ).toEqual(["database-page"]);
  });

  it("removes descendants of database row pages from the sidebar tree", () => {
    const database = doc("database-page", null);
    const row = {
      ...doc("row-page", "database-page"),
      databaseMembership: {
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "Content calendar",
        position: 0,
      },
    };
    const child = doc("row-child", "row-page");
    const sibling = doc("ordinary-page", null);

    expect(
      filterDocumentTreeDocuments([database, row, child, sibling]).map(
        (node) => node.id,
      ),
    ).toEqual(["database-page", "ordinary-page"]);
  });
});

describe("mergeDocumentIntoListDocumentsCache", () => {
  it("updates the saved document title in array-shaped list caches", () => {
    const updated = {
      ...doc("a", null),
      title: "This is a page with a very long title",
    };

    expect(
      mergeDocumentIntoListDocumentsCache(
        [doc("a", null), doc("b", null)],
        updated,
      ),
    ).toEqual([updated, doc("b", null)]);
  });

  it("updates the saved document title in object-shaped list caches", () => {
    const updated = {
      ...doc("a", null),
      title: "This is a page with a very long title",
    };

    expect(
      mergeDocumentIntoListDocumentsCache(
        { documents: [doc("a", null)], cursor: null },
        updated,
      ),
    ).toEqual({ documents: [updated], cursor: null });
  });
});

describe("mergeDocumentIntoDocumentCache", () => {
  it("preserves fields that are only present on the get-document cache", () => {
    const updated = {
      ...doc("database-page", null),
      title: "Updated title",
    };
    const database = {
      id: "database",
      documentId: "database-page",
      title: "Database",
      viewConfig: {
        activeViewId: "default",
        views: [],
        sorts: [],
        filters: [],
        columnWidths: {},
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    };

    expect(
      mergeDocumentIntoDocumentCache(
        { ...doc("database-page", null), database },
        updated,
      ),
    ).toEqual({ ...updated, database });
  });
});
