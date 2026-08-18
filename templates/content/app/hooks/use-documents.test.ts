// @vitest-environment happy-dom

import type { ContentDatabaseItem, Document } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
  buildDocumentTree,
  DOCUMENT_QUERY_FRESHNESS_OPTIONS,
  documentUpdateSuccessPatch,
  fetchCompleteDocumentList,
  LIST_DOCUMENTS_QUERY_KEY,
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
  useDocuments,
} from "./use-documents";

describe("complete document discovery", () => {
  it("keeps object-shaped optimistic cache writes array-shaped for consumers", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const optimisticDocument = doc("optimistic-document", null);
    queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, {
      documents: [optimisticDocument],
    });
    let consumerData: unknown;
    function Consumer() {
      consumerData = useDocuments().data;
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Consumer),
          ),
        );
      });

      expect(Array.isArray(consumerData)).toBe(true);
      expect(consumerData).toEqual([optimisticDocument]);
    } finally {
      await act(async () => root.unmount());
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      queryClient.clear();
    }
  });

  it("exhausts every bounded page before returning the document tree", async () => {
    const documents = Array.from({ length: 401 }, (_, index) =>
      doc(`document-${index}`, null, index),
    );
    const offsets: number[] = [];

    const result = await fetchCompleteDocumentList(async (offset, limit) => {
      offsets.push(offset);
      const page = documents.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        documents: page,
        pagination: {
          offset,
          limit,
          totalItems: documents.length,
          returnedItems: page.length,
          hasMore: nextOffset < documents.length,
          nextOffset: nextOffset < documents.length ? nextOffset : null,
        },
      };
    });

    expect(offsets).toEqual([0, 200, 400]);
    expect(result.map((document) => document.id)).toEqual(
      documents.map((document) => document.id),
    );
  });

  it("rejects a response whose missing boundary could hide clipping", async () => {
    await expect(
      fetchCompleteDocumentList(
        async () =>
          ({
            documents: [doc("document-1", null)],
          }) as never,
      ),
    ).rejects.toThrow("returned no pagination boundary");
  });

  it("rejects a non-advancing continuation", async () => {
    await expect(
      fetchCompleteDocumentList(async (_offset, limit) => ({
        documents: [],
        pagination: {
          offset: 0,
          limit,
          totalItems: 1,
          returnedItems: 0,
          hasMore: true,
          nextOffset: 0,
        },
      })),
    ).rejects.toThrow("non-advancing continuation");
  });
});

describe("document query freshness", () => {
  it("always replaces seeded row snapshots before the editor mounts", () => {
    expect(DOCUMENT_QUERY_FRESHNESS_OPTIONS).toMatchObject({
      staleTime: 0,
      refetchOnMount: "always",
      retry: false,
    });
  });

  it("keeps membership contexts in separate Page query keys", () => {
    expect(
      documentQueryKey("shared-page", {
        databaseId: "local-database",
        databaseDocumentId: "local-database-page",
      }),
    ).toEqual([
      "action",
      "get-document",
      {
        id: "shared-page",
        databaseId: "local-database",
        databaseDocumentId: "local-database-page",
      },
    ]);
    expect(
      documentQueryKey("shared-page", {
        databaseId: "builder-database",
        databaseDocumentId: "builder-database-page",
      }),
    ).not.toEqual(
      documentQueryKey("shared-page", {
        databaseId: "local-database",
        databaseDocumentId: "local-database-page",
      }),
    );
    expect(documentQueryKey("shared-page")).toEqual([
      "action",
      "get-document",
      { id: "shared-page" },
    ]);
  });
});

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

    patchDocumentCaches(queryClient, "a", {
      title: "Page one",
      content: "Saved body",
    });

    expect(
      queryClient.getQueryData<Document>(documentQueryKey("a"))?.title,
    ).toBe("Page one");
    expect(
      queryClient.getQueryData<Document>(documentQueryKey("a"))?.content,
    ).toBe("Saved body");
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
    expect(
      queryClient.getQueryData<any>(databaseKey)?.items[0].document.content,
    ).toBe("Saved body");
  });

  it("patches Page-owned fields across contexts without exchanging memberships", () => {
    const queryClient = new QueryClient();
    const localKey = documentQueryKey("shared-page", {
      databaseId: "local-database",
      databaseDocumentId: "local-database-page",
    });
    const builderKey = documentQueryKey("shared-page", {
      databaseId: "builder-database",
      databaseDocumentId: "builder-database-page",
    });
    queryClient.setQueryData(localKey, {
      ...doc("shared-page", null),
      databaseMembership: {
        databaseId: "local-database",
        databaseDocumentId: "local-database-page",
        databaseTitle: "Local",
        position: 0,
      },
    });
    queryClient.setQueryData(builderKey, {
      ...doc("shared-page", null),
      databaseMembership: {
        databaseId: "builder-database",
        databaseDocumentId: "builder-database-page",
        databaseTitle: "Builder",
        position: 0,
        sourceId: "builder-source",
      },
    });

    patchDocumentCaches(queryClient, "shared-page", {
      title: "Shared title",
      content: "Shared body",
    });

    expect(queryClient.getQueryData<Document>(localKey)).toMatchObject({
      title: "Shared title",
      content: "Shared body",
      databaseMembership: { databaseId: "local-database" },
    });
    expect(queryClient.getQueryData<Document>(builderKey)).toMatchObject({
      title: "Shared title",
      content: "Shared body",
      databaseMembership: { databaseId: "builder-database" },
    });
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

  it("never copies membership or hydration context between query variants", () => {
    const localMembership = {
      databaseId: "local-database",
      databaseDocumentId: "local-database-page",
      databaseTitle: "Local",
      position: 0,
    };
    const merged = mergeDocumentIntoDocumentCache(
      {
        ...doc("shared-page", null),
        databaseMembership: localMembership,
      },
      {
        ...doc("shared-page", null),
        title: "Server title",
        databaseMembership: {
          databaseId: "builder-database",
          databaseDocumentId: "builder-database-page",
          databaseTitle: "Builder",
          position: 0,
        },
        bodyHydration: {
          provider: "builder",
          hydration: {
            status: "pending",
            attemptedAt: null,
            error: null,
            version: null,
          },
        },
      },
    );

    expect(merged).toMatchObject({
      title: "Server title",
      databaseMembership: localMembership,
    });
    expect(merged).not.toHaveProperty("bodyHydration");
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
      content: "Saved body",
      updatedAt: "2026-05-12T00:00:01.000Z",
      urlPath: "/page/page",
      softDeletedDatabaseIds: [],
    };

    expect(
      documentUpdateSuccessPatch(response, {
        id: "page",
        title: "Renamed",
        content: "Saved body",
      }),
    ).toEqual({
      title: "Renamed",
      content: "Saved body",
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
  it("warms properties without treating a database row snapshot as an editable document", () => {
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

    expect(queryClient.getQueryData(documentQueryKey("row-page"))).toBe(
      undefined,
    );
    expect(
      queryClient.getQueryData(
        documentPropertiesQueryKey("row-page", "database"),
      ),
    ).toEqual({
      documentId: "row-page",
      databaseId: "database",
      properties: item.properties,
    });
  });

  it("keeps property caches separate for one page in two databases", () => {
    const queryClient = new QueryClient();
    const item = (databaseId: string, propertyId: string, value: string) =>
      ({
        id: `item-${databaseId}`,
        databaseId,
        position: 0,
        document: {
          ...doc("shared-row", `page-${databaseId}`),
          databaseMembership: {
            databaseId,
            databaseDocumentId: `page-${databaseId}`,
            databaseTitle: databaseId,
            position: 0,
          },
        },
        properties: [
          {
            definition: {
              id: propertyId,
              databaseId,
              name: propertyId,
              type: "select",
              visibility: "always_show",
              options: { options: [] },
              position: 0,
              createdAt: "2026-07-24T00:00:00.000Z",
              updatedAt: "2026-07-24T00:00:00.000Z",
            },
            value,
            editable: true,
          },
        ],
      }) as ContentDatabaseItem;

    const filesItem = item("files-database", "Kind", "Page");
    const projectItem = item("project-database", "Status", "In progress");
    seedDatabaseItemDocumentCaches(queryClient, filesItem);
    seedDatabaseItemDocumentCaches(queryClient, projectItem);

    expect(
      queryClient.getQueryData(
        documentPropertiesQueryKey("shared-row", "files-database"),
      ),
    ).toMatchObject({
      databaseId: "files-database",
      properties: filesItem.properties,
    });
    expect(
      queryClient.getQueryData(
        documentPropertiesQueryKey("shared-row", "project-database"),
      ),
    ).toMatchObject({
      databaseId: "project-database",
      properties: projectItem.properties,
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
      queryClient.getQueryData(
        documentPropertiesQueryKey("row-page", "database"),
      ),
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
      queryClient.getQueryData(
        documentPropertiesQueryKey("row-page", "database"),
      ),
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
