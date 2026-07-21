import type { ContentDatabaseItem, Document } from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  buildDocumentTree,
  documentUpdateSuccessPatch,
  documentPropertiesQueryKey,
  documentQueryKey,
  filterDocumentTreeDocuments,
  isDocumentUpdateConflict,
  mergeDocumentIntoDocumentCache,
  mergeDocumentIntoListDocumentsCache,
  patchDocumentCaches,
  patchContentSpaceNameCaches,
  patchDocumentInDatabaseCache,
  patchDocumentInListDocumentsCache,
  restoreQuerySnapshots,
  setDocumentFavoriteInDatabaseCache,
  setDocumentFavoriteInListCache,
  seedDatabaseItemDocumentCaches,
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

describe("optimistic document favorites", () => {
  it("updates array and object list caches without disturbing other pages", () => {
    const favorite = { ...doc("a", null), isFavorite: true };
    expect(
      setDocumentFavoriteInListCache(
        [doc("a", null), doc("b", null)],
        "a",
        true,
      ),
    ).toEqual([favorite, doc("b", null)]);
    expect(
      setDocumentFavoriteInListCache(
        { documents: [doc("a", null)], cursor: "next" },
        "a",
        true,
      ),
    ).toEqual({ documents: [favorite], cursor: "next" });
  });

  it("updates the matching row in every Files database cache shape", () => {
    const database = {
      items: [
        {
          id: "item-a",
          databaseId: "files",
          position: 0,
          document: doc("a", null),
          properties: [],
        },
        {
          id: "item-b",
          databaseId: "files",
          position: 1,
          document: doc("b", null),
          properties: [],
        },
      ],
    } as any;

    const updated = setDocumentFavoriteInDatabaseCache(database, "a", true)!;
    expect(updated.items[0].document.isFavorite).toBe(true);
    expect(updated.items[1].document.isFavorite).toBe(false);
    expect(database.items[0].document.isFavorite).toBe(false);
  });

  it("removes unfavorited pages from a cached Favorites database", () => {
    const database = {
      database: { systemRole: "favorites" },
      items: [
        {
          id: "item-a",
          databaseId: "favorites",
          position: 0,
          document: { ...doc("a", null), isFavorite: true },
          properties: [],
        },
        {
          id: "item-b",
          databaseId: "favorites",
          position: 1,
          document: { ...doc("b", null), isFavorite: true },
          properties: [],
        },
      ],
      pagination: {
        offset: 0,
        limit: 50,
        totalItems: 2,
        returnedItems: 2,
        hasMore: false,
      },
    } as any;

    const updated = setDocumentFavoriteInDatabaseCache(database, "a", false)!;
    expect(updated.items.map((item) => item.document.id)).toEqual(["b"]);
    expect(updated.pagination).toMatchObject({
      totalItems: 1,
      returnedItems: 1,
    });
    expect(database.items).toHaveLength(2);
  });

  it("leaves a cached Favorites database unchanged until a newly added row refetches", () => {
    const database = {
      database: { systemRole: "favorites" },
      items: [],
      pagination: {
        offset: 0,
        limit: 50,
        totalItems: 0,
        returnedItems: 0,
        hasMore: false,
      },
    } as any;

    expect(setDocumentFavoriteInDatabaseCache(database, "a", true)).toBe(
      database,
    );
  });

  it("restores exact cache snapshots after a failed optimistic update", () => {
    const queryClient = new QueryClient();
    const documentKey = documentQueryKey("a");
    const listKey = ["action", "list-documents", undefined] as const;
    const originalDocument = doc("a", null);
    const originalList = [originalDocument];
    queryClient.setQueryData(documentKey, {
      ...originalDocument,
      isFavorite: true,
    });
    queryClient.setQueryData(listKey, [
      { ...originalDocument, isFavorite: true },
    ]);

    restoreQuerySnapshots(queryClient, [
      [documentKey, originalDocument],
      [listKey, originalList],
    ]);

    expect(queryClient.getQueryData(documentKey)).toEqual(originalDocument);
    expect(queryClient.getQueryData(listKey)).toEqual(originalList);
  });
});

describe("optimistic document titles", () => {
  it("renames the workspace sidebar and catalog row with its Files title", () => {
    const queryClient = new QueryClient();
    const spacesKey = ["action", "list-content-spaces", undefined] as const;
    const workspacesKey = [
      "action",
      "get-content-database",
      { documentId: "workspaces-document" },
    ] as const;
    queryClient.setQueryData(spacesKey, {
      spaces: [
        {
          name: "Old workspace",
          filesDocumentId: "files-document",
          catalogDocumentId: "catalog-document",
        },
      ],
    });
    queryClient.setQueryData(workspacesKey, {
      items: [
        {
          id: "catalog-item",
          databaseId: "workspaces",
          position: 0,
          document: doc("catalog-document", null),
          properties: [],
        },
      ],
    });

    expect(
      patchContentSpaceNameCaches(
        queryClient,
        "files-document",
        "Renamed workspace",
      ),
    ).toBe(true);
    expect(queryClient.getQueryData<any>(spacesKey)?.spaces[0].name).toBe(
      "Renamed workspace",
    );
    expect(
      queryClient.getQueryData<any>(workspacesKey)?.items[0].document.title,
    ).toBe("Renamed workspace");
  });

  it("renames matching sidebar documents and Files rows immediately", () => {
    const list = [doc("a", null), doc("b", null)];
    const database = {
      items: [
        {
          id: "item-a",
          databaseId: "files",
          position: 0,
          document: doc("a", null),
          properties: [],
        },
      ],
    } as any;

    expect(
      patchDocumentInListDocumentsCache(list, "a", { title: "Page one" }),
    ).toEqual([{ ...doc("a", null), title: "Page one" }, doc("b", null)]);
    expect(
      patchDocumentInDatabaseCache(database, "a", { title: "Page one" })
        ?.items[0].document.title,
    ).toBe("Page one");
    expect(database.items[0].document.title).toBe("a");
  });

  it("updates every sidebar-facing cache before the save round trip", () => {
    const queryClient = new QueryClient();
    const databaseKey = [
      "action",
      "get-content-database",
      { databaseId: "files" },
    ] as const;
    queryClient.setQueryData(documentQueryKey("a"), doc("a", null));
    queryClient.setQueryData(
      ["action", "list-documents", undefined],
      [doc("a", null)],
    );
    queryClient.setQueryData(databaseKey, {
      items: [
        {
          id: "item-a",
          databaseId: "files",
          position: 0,
          document: doc("a", null),
          properties: [],
        },
      ],
    });

    patchDocumentCaches(queryClient, "a", { title: "Page one" });

    expect(
      queryClient.getQueryData<Document>(documentQueryKey("a"))?.title,
    ).toBe("Page one");
    expect(
      queryClient.getQueryData<Document[]>([
        "action",
        "list-documents",
        undefined,
      ])?.[0].title,
    ).toBe("Page one");
    expect(
      queryClient.getQueryData<any>(databaseKey)?.items[0].document.title,
    ).toBe("Page one");
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

describe("documentUpdateSuccessPatch", () => {
  it("does not let an icon-only response overwrite a newer optimistic title", () => {
    const response = {
      ...doc("page", null),
      title: "Untitled",
      icon: "🌱",
      updatedAt: "2026-05-12T00:00:01.000Z",
      urlPath: "/page/page",
      softDeletedDatabaseIds: [],
    };

    const patch = documentUpdateSuccessPatch(response, {
      id: "page",
      icon: "🌱",
    });

    expect({ ...doc("page", null), title: "Renamed", ...patch }).toMatchObject({
      title: "Renamed",
      icon: "🌱",
      updatedAt: "2026-05-12T00:00:01.000Z",
    });
    expect(patch).not.toHaveProperty("title");
  });

  it("reconciles fields that were part of the successful mutation", () => {
    const response = {
      ...doc("page", null),
      title: "Renamed",
      updatedAt: "2026-05-12T00:00:01.000Z",
      urlPath: "/page/page",
      softDeletedDatabaseIds: [],
    };

    expect(
      documentUpdateSuccessPatch(response, {
        id: "page",
        title: "Renamed",
      }),
    ).toEqual({
      title: "Renamed",
      updatedAt: "2026-05-12T00:00:01.000Z",
    });
  });
});

describe("isDocumentUpdateConflict", () => {
  it("recognizes a conflict result", () => {
    expect(
      isDocumentUpdateConflict({
        conflict: true,
        id: "doc-1",
        document: { ...doc("doc-1", null), urlPath: "/page/doc-1" } as any,
      }),
    ).toBe(true);
  });

  it("does not treat a normal saved document as a conflict", () => {
    expect(
      isDocumentUpdateConflict({
        ...doc("doc-1", null),
        urlPath: "/page/doc-1",
        softDeletedDatabaseIds: [],
      } as any),
    ).toBe(false);
  });
});

describe("seedDatabaseItemDocumentCaches", () => {
  it("warms get-document and list-document-properties from a database row", () => {
    const queryClient = new QueryClient();
    const item: ContentDatabaseItem = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...doc("row-page", "database-page"),
        title: "Builder blog launch",
        icon: "B",
        canEdit: true,
        canManage: true,
        databaseMembership: {
          databaseId: "database",
          databaseDocumentId: "database-page",
          databaseTitle: "Content calendar",
          position: 0,
        },
      },
      properties: [
        {
          definition: {
            id: "status",
            databaseId: "database",
            name: "Status",
            type: "text",
            visibility: "always_show",
            options: {},
            position: 0,
            createdAt: "2026-05-12T00:00:00.000Z",
            updatedAt: "2026-05-12T00:00:00.000Z",
          },
          value: "Draft",
          editable: true,
        },
      ],
    };

    seedDatabaseItemDocumentCaches(queryClient, item);

    expect(
      queryClient.getQueryData(documentQueryKey("row-page")),
    ).toMatchObject({
      id: "row-page",
      title: "Builder blog launch",
      icon: "B",
      properties: item.properties,
    });
    expect(
      queryClient.getQueryData(documentPropertiesQueryKey("row-page")),
    ).toEqual({
      documentId: "row-page",
      databaseId: "database",
      properties: item.properties,
    });
  });

  it("skips get-document body seeding for rows whose Builder body is still hydrating", () => {
    const queryClient = new QueryClient();
    const item: ContentDatabaseItem = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...doc("row-page", "database-page"),
        title: "Builder blog launch",
        content: "",
        databaseMembership: {
          databaseId: "database",
          databaseDocumentId: "database-page",
          databaseTitle: "Content calendar",
          position: 0,
          sourceId: "builder-source",
          bodyHydration: {
            status: "hydrating",
            attemptedAt: "2026-07-02T12:00:00.000Z",
            error: null,
            version: null,
          },
        },
      },
      properties: [],
      bodyHydration: {
        status: "hydrating",
        attemptedAt: "2026-07-02T12:00:00.000Z",
        error: null,
        version: null,
      },
    };

    seedDatabaseItemDocumentCaches(queryClient, item);

    expect(queryClient.getQueryData(documentQueryKey("row-page"))).toBe(
      undefined,
    );
    expect(
      queryClient.getQueryData(documentPropertiesQueryKey("row-page")),
    ).toEqual({
      documentId: "row-page",
      databaseId: "database",
      properties: [],
    });
  });

  it("skips get-document body seeding for source-backed rows with empty list content", () => {
    const queryClient = new QueryClient();
    const item: ContentDatabaseItem = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...doc("row-page", "database-page"),
        title: "Builder blog launch",
        content: "",
        databaseMembership: {
          databaseId: "database",
          databaseDocumentId: "database-page",
          databaseTitle: "Content calendar",
          position: 0,
          bodyHydration: {
            status: "hydrated",
            attemptedAt: "2026-07-02T12:00:00.000Z",
            error: null,
            version: "2026-07-02T12:00:00.000Z:readable-native-images-v5",
          },
        },
      },
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: "2026-07-02T12:00:00.000Z",
        error: null,
        version: "2026-07-02T12:00:00.000Z:readable-native-images-v5",
      },
    };

    seedDatabaseItemDocumentCaches(queryClient, item);

    expect(queryClient.getQueryData(documentQueryKey("row-page"))).toBe(
      undefined,
    );
    expect(
      queryClient.getQueryData(documentPropertiesQueryKey("row-page")),
    ).toEqual({
      documentId: "row-page",
      databaseId: "database",
      properties: [],
    });
  });

  it("does not treat a non-empty source-backed list snapshot as an authoritative document", () => {
    const queryClient = new QueryClient();
    const item: ContentDatabaseItem = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...doc("row-page", "database-page"),
        title: "Builder blog launch",
        content: "Possibly stale table snapshot",
        databaseMembership: {
          databaseId: "database",
          databaseDocumentId: "database-page",
          databaseTitle: "Content calendar",
          position: 0,
          sourceId: "builder-source",
          bodyHydration: {
            status: "hydrated",
            attemptedAt: "2026-07-02T12:00:00.000Z",
            error: null,
            version: "v1",
          },
        },
      },
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: "2026-07-02T12:00:00.000Z",
        error: null,
        version: "v1",
      },
    };

    seedDatabaseItemDocumentCaches(queryClient, item);

    expect(queryClient.getQueryData(documentQueryKey("row-page"))).toBe(
      undefined,
    );
  });

  it("treats row-level body hydration alone as source-backed for cache seeding", () => {
    const queryClient = new QueryClient();
    const item: ContentDatabaseItem = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...doc("row-page", "database-page"),
        content: "Possibly stale hydrated body",
        databaseMembership: {
          databaseId: "database",
          databaseDocumentId: "database-page",
          databaseTitle: "Content calendar",
          position: 0,
        },
      },
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: "2026-07-02T12:00:00.000Z",
        error: null,
        version: "v1",
      },
    };

    seedDatabaseItemDocumentCaches(queryClient, item);

    expect(queryClient.getQueryData(documentQueryKey("row-page"))).toBe(
      undefined,
    );
  });

  it("does not overwrite an already-warm get-document cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(documentQueryKey("row-page"), {
      ...doc("row-page", "database-page"),
      title: "Freshly saved title",
      content: "Full body",
      source: { mode: "database" },
    });

    seedDatabaseItemDocumentCaches(queryClient, {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...doc("row-page", "database-page"),
        title: "Stale table title",
      },
      properties: [],
    });

    expect(
      queryClient.getQueryData(documentQueryKey("row-page")),
    ).toMatchObject({
      id: "row-page",
      title: "Freshly saved title",
      content: "Full body",
      source: { mode: "database" },
    });
  });
});
