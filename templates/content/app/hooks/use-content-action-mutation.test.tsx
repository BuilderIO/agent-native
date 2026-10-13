// @vitest-environment happy-dom

import { useActionMutation } from "@agent-native/core/client/hooks";
import type { ContentNavigationContext, Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

import { useDeleteComment } from "./use-comments";
import { useContentActionMutation } from "./use-content-action-mutation";
import {
  useDuplicateDatabaseItem,
  useRemoveDatabaseItems,
} from "./use-content-database";
import { useRestoreTrashItem } from "./use-content-trash";
import {
  removeCreatedDocumentNavigation,
  seedCreatedDocumentNavigation,
  useCreateDocument,
  useDeleteDocument,
  useMoveDocument,
  usePermanentlyDeleteDocument,
  useRestoreDocument,
  useUpdateDocument,
} from "./use-documents";
import { usePullDocumentFromNotion } from "./use-notion";

const FILES = "files-db";
const FILES_2 = "files-db-2";
const FAVORITES = "favorites-db";

function navigation(
  databaseId: string,
  parentId: string | null,
  cursor?: string,
): QueryKey {
  return [
    "action",
    "query-content-database-items",
    {
      databaseId,
      limit: 20,
      navigation: { parentId, sort: "custom", ...(cursor ? { cursor } : {}) },
    },
  ];
}

const keys = {
  root: navigation(FILES, null),
  rootPage2: navigation(FILES, null, "root-2"),
  sectionChildren: navigation(FILES, "section"),
  sectionChildrenPage2: navigation(FILES, "section", "section-2"),
  pageChildren: navigation(FILES, "page"),
  otherChildren: navigation(FILES, "other"),
  space2Root: navigation(FILES_2, null),
  pagePath: ["action", "get-content-navigation-context", { id: "page" }],
  otherPath: ["action", "get-content-navigation-context", { id: "other" }],
  newPath: ["action", "get-content-navigation-context", { id: "new-page" }],
  recent: ["action", "get-content-recent", { spaceId: "space" }],
  files: ["action", "get-content-database", { databaseId: FILES }],
  favorites: [
    "action",
    "get-content-database",
    { databaseId: FAVORITES, limit: 50, contentSpaceId: "space" },
  ],
  tracker: ["action", "get-content-database", { documentId: "tracker-page" }],
  trackerTable: [
    "action",
    "query-content-database-items",
    {
      documentId: "tracker-page",
      limit: 100,
      tableQuery: { sorts: [{ key: "title", direction: "asc" }] },
    },
  ],
  documents: ["action", "list-documents", undefined],
  pageDoc: ["action", "get-document", { id: "page" }],
  siblingDoc: ["action", "get-document", { id: "sibling" }],
  pageProperties: [
    "action",
    "list-document-properties",
    { documentId: "page", databaseId: FILES },
  ],
  comments: ["action", "list-comments", { documentId: "page" }],
  commentAi: ["action", "list-comment-ai-requests", { documentId: "page" }],
  spaces: ["action", "list-content-spaces", undefined],
  trashedDocuments: ["action", "list-trashed-documents", {}],
  trashedDatabases: ["action", "list-trashed-content-databases", {}],
  trash: ["action", "list-content-trash", {}],
  search: ["action", "search-documents", { query: "page" }],
} satisfies Record<string, QueryKey>;

type ReadName = keyof typeof keys;

const meta: Partial<Record<ReadName, Record<string, unknown>>> = {
  files: { contentDatabaseSystemRole: "files" },
  favorites: { contentDatabaseSystemRole: "favorites" },
};

function branch(...documentIds: string[]) {
  return {
    items: documentIds.map((documentId) => ({
      membershipId: `m-${documentId}`,
      documentId,
      title: documentId,
    })),
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  };
}

function path(...ids: string[]) {
  return {
    document: { id: ids[ids.length - 1], title: ids[ids.length - 1] },
    path: ids.map((id) => ({ id, title: id })),
  };
}

const seed: Partial<Record<ReadName, unknown>> = {
  root: branch("section", "other"),
  rootPage2: branch("late-root"),
  sectionChildren: branch("page", "sibling"),
  sectionChildrenPage2: branch("late-sibling"),
  pageChildren: branch(),
  otherChildren: branch("other-child"),
  space2Root: branch("space-2-page"),
  pagePath: path("section", "page"),
  otherPath: path("other"),
  recent: {
    entries: [{ target: { documentId: "page" }, title: "page" }],
  },
  files: { database: { id: FILES }, items: [] },
  documents: { documents: [] },
  comments: { comments: [] },
  spaces: {
    spaces: [
      { id: "space", filesDatabaseId: FILES },
      { id: "space-2", filesDatabaseId: FILES_2 },
    ],
  },
};

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;
let reads: Map<ReadName, ReturnType<typeof vi.fn>>;
let unsubscribes: Array<() => void>;
let actionResponses: Record<string, unknown>;

/** Mount reads as active observers, then count only the fetches that follow. */
async function mountReads(names = Object.keys(keys) as ReadName[]) {
  for (const name of names) {
    const queryFn = vi.fn(async () => seed[name] ?? null);
    reads.set(name, queryFn);
    if (seed[name] !== undefined)
      queryClient.setQueryData(keys[name], seed[name]);
    const observer = new QueryObserver(queryClient, {
      queryKey: keys[name],
      queryFn,
      meta: meta[name],
      staleTime: Infinity,
      retry: false,
    });
    unsubscribes.push(observer.subscribe(() => {}));
  }
  await refetched();
  reads.forEach((queryFn) => queryFn.mockClear());
}

async function refetched() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return [...reads.entries()]
    .filter(([, queryFn]) => queryFn.mock.calls.length > 0)
    .map(([name]) => name)
    .sort();
}

async function renderHook<T>(hook: () => T) {
  const result: { current: T | null } = { current: null };
  function Harness() {
    result.current = hook();
    return null;
  }
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  await act(async () =>
    root.render(
      <Providers>
        <Harness />
      </Providers>,
    ),
  );
  return result as { current: T };
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  reads = new Map();
  unsubscribes = [];
  actionResponses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const name = new URL(url, "http://localhost").pathname.split("/").pop()!;
      return new Response(JSON.stringify(actionResponses[name] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(async () => {
  unsubscribes.forEach((unsubscribe) => unsubscribe());
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("useContentActionMutation", () => {
  it("refreshes only its named targets, where a plain action mutation refreshes every read", async () => {
    await mountReads();
    actionResponses["delete-comment"] = { ok: true };
    const hooks = await renderHook(() => ({
      content: useContentActionMutation<
        { ok: boolean },
        { id: string; documentId: string }
      >("delete-comment", {
        invalidates: (_data, variables) => [
          ["action", "list-comments", { documentId: variables.documentId }],
        ],
      }),
      plain: useActionMutation("delete-comment"),
    }));

    await act(() =>
      hooks.current.content.mutateAsync({ id: "c1", documentId: "page" }),
    );
    expect(await refetched()).toEqual(["comments"]);

    reads.forEach((queryFn) => queryFn.mockClear());
    await act(() =>
      hooks.current.plain.mutateAsync({ id: "c1", documentId: "page" }),
    );
    expect(await refetched()).toEqual(Object.keys(keys).sort());
  });

  it("runs the caller's onSuccess before refreshing and accepts static targets", async () => {
    await mountReads(["comments", "documents"]);
    const order: string[] = [];
    reads.get("comments")!.mockImplementation(async () => {
      order.push("refetch");
      return seed.comments;
    });
    const hooks = await renderHook(() =>
      useContentActionMutation("export-document", {
        onSuccess: () => {
          order.push("onSuccess");
        },
        invalidates: [keys.comments],
      }),
    );

    await act(() => hooks.current.mutateAsync({ id: "page" }));
    expect(await refetched()).toEqual(["comments"]);
    expect(order).toEqual(["onSuccess", "refetch"]);
  });
});

describe("sidebar writes refresh only the affected branch", () => {
  it("rename refreshes every page of the renamed row's branch, its path, sorted tables, and search", async () => {
    await mountReads();
    actionResponses["update-document"] = {
      id: "page",
      title: "Renamed",
      updatedAt: "2026-09-27T00:00:00.000Z",
      softDeletedDatabaseIds: [],
    };
    const update = await renderHook(() => useUpdateDocument());

    await act(() =>
      update.current.mutateAsync({ id: "page", title: "Renamed" }),
    );

    expect(await refetched()).toEqual([
      "pagePath",
      "search",
      "sectionChildren",
      "sectionChildrenPage2",
      "trackerTable",
    ]);
    expect(queryClient.getQueryData<any>(keys.recent).entries[0].title).toBe(
      "Renamed",
    );
  });

  it("create refreshes the parent's children, the parent's row, and the new page's path", async () => {
    await mountReads();
    actionResponses["create-document"] = {
      id: "new-page",
      parentId: "page",
      spaceId: "space",
      title: "",
    };
    const create = await renderHook(() => useCreateDocument());

    await act(() =>
      create.current.mutateAsync({ id: "new-page", parentId: "page" }),
    );

    expect(await refetched()).toEqual([
      "newPath",
      "pageChildren",
      "sectionChildren",
    ]);
  });

  it("a root create refreshes only its own space's root branch", async () => {
    await mountReads([
      "root",
      "rootPage2",
      "sectionChildren",
      "spaces",
      "space2Root",
    ]);
    actionResponses["create-document"] = {
      id: "new-page",
      parentId: null,
      spaceId: "space",
      title: "",
    };
    const create = await renderHook(() => useCreateDocument());

    await act(() => create.current.mutateAsync({ id: "new-page" }));

    expect(await refetched()).toEqual(["root", "rootPage2"]);
  });

  it("move refreshes the old branch, the new parent's children and row, and the Files collection", async () => {
    await mountReads();
    actionResponses["move-document"] = { id: "sibling", parentId: "other" };
    const move = await renderHook(() => useMoveDocument());

    await act(() =>
      move.current.mutateAsync({ id: "sibling", parentId: "other" }),
    );

    expect(await refetched()).toEqual([
      "documents",
      "files",
      "otherChildren",
      "root",
      "sectionChildren",
      "sectionChildrenPage2",
      "siblingDoc",
    ]);
  });

  it("a cross-space move refreshes the destination space's root, not the source root's later pages", async () => {
    await mountReads();
    actionResponses["move-document"] = { id: "sibling", parentId: null };
    const move = await renderHook(() => useMoveDocument());

    await act(() =>
      move.current.mutateAsync({
        id: "sibling",
        parentId: null,
        spaceId: "space-2",
      }),
    );

    expect(await refetched()).toEqual([
      "documents",
      "favorites",
      "files",
      "recent",
      "root",
      "sectionChildren",
      "sectionChildrenPage2",
      "siblingDoc",
      "space2Root",
      "tracker",
    ]);
  });
});

describe("Trash writes", () => {
  const trashLists = ["trash", "trashedDatabases", "trashedDocuments"];

  it("delete refreshes the deleted row's branch, its parent's row, collections, search, and Trash", async () => {
    await mountReads();
    actionResponses["delete-document"] = { success: true, deleted: 1 };
    const remove = await renderHook(() => useDeleteDocument());

    await act(() => remove.current.mutateAsync({ id: "sibling" }));

    expect(await refetched()).toEqual(
      [
        "documents",
        "favorites",
        "files",
        "recent",
        "root",
        "search",
        "sectionChildren",
        "sectionChildrenPage2",
        "siblingDoc",
        "spaces",
        "tracker",
        ...trashLists,
      ].sort(),
    );
  });

  it.each([
    ["the sidebar", () => useRestoreDocument()],
    ["the Trash page", () => useRestoreTrashItem()],
  ])(
    "restore from %s refreshes every branch, sorted tables, collections, and Trash",
    async (_surface, hook) => {
      await mountReads();
      actionResponses["restore-document"] = {
        success: true,
        restored: 1,
        documentId: "sibling",
      };
      const restore = await renderHook(hook);

      await act(() => restore.current.mutateAsync({ id: "sibling" }));

      expect(await refetched()).toEqual(
        [
          "documents",
          "favorites",
          "files",
          "otherChildren",
          "pageChildren",
          "recent",
          "root",
          "rootPage2",
          "search",
          "sectionChildren",
          "sectionChildrenPage2",
          "siblingDoc",
          "space2Root",
          "tracker",
          "trackerTable",
          ...trashLists,
        ].sort(),
      );
    },
  );

  it("permanent delete refreshes the page's reads and Trash", async () => {
    await mountReads();
    actionResponses["plan-content-trash-purge"] = {
      planId: "plan",
      scopeToken: "scope",
    };
    actionResponses["permanently-delete-document"] = {
      success: true,
      deleted: 1,
    };
    const purge = await renderHook(() => usePermanentlyDeleteDocument());

    await act(() => purge.current.mutateAsync({ id: "sibling" }));

    expect(await refetched()).toEqual(
      ["documents", "siblingDoc", ...trashLists].sort(),
    );
  });
});

describe("collection row writes", () => {
  it("duplicate refreshes the collection and its sorted table", async () => {
    await mountReads();
    actionResponses["duplicate-database-item"] = {
      database: { id: "tracker-db" },
      items: [],
    };
    const duplicate = await renderHook(() =>
      useDuplicateDatabaseItem("tracker-page"),
    );

    await act(() => duplicate.current.mutateAsync({ itemId: "item-page" }));

    expect(await refetched()).toEqual(["documents", "tracker", "trackerTable"]);
  });

  it("bulk removal by item id refreshes the removed pages named in the response", async () => {
    await mountReads();
    actionResponses["remove-database-items"] = {
      database: { id: "tracker-db" },
      items: [],
      removedItemIds: ["item-page"],
      removedDocumentIds: ["page"],
    };
    const removeRows = await renderHook(() =>
      useRemoveDatabaseItems("tracker-page"),
    );

    await act(() =>
      removeRows.current.mutateAsync({
        documentId: "tracker-page",
        itemIds: ["item-page"],
      }),
    );

    expect(await refetched()).toEqual([
      "documents",
      "pageDoc",
      "pagePath",
      "pageProperties",
      "tracker",
      "trackerTable",
    ]);
  });

  it("unfavoriting from the Favorites page refreshes the sidebar Favorites list and the page's star", async () => {
    await mountReads();
    actionResponses["remove-database-items"] = {
      database: { id: FAVORITES, systemRole: "favorites" },
      items: [],
      removedItemIds: ["favorite-page"],
      removedDocumentIds: ["page"],
    };
    const removeRows = await renderHook(() =>
      useRemoveDatabaseItems("favorites-page"),
    );

    await act(() =>
      removeRows.current.mutateAsync({
        documentId: "favorites-page",
        itemIds: ["favorite-page"],
      }),
    );

    expect(await refetched()).toEqual([
      "documents",
      "favorites",
      "pageDoc",
      "pagePath",
      "pageProperties",
      "sectionChildren",
    ]);
  });
});

describe("page writes", () => {
  it("a Notion pull refreshes the page, the branches that gain or lose its children, and the Files collection", async () => {
    await mountReads();
    actionResponses["pull-notion-page"] = { connected: true, pageId: "n1" };
    const pull = await renderHook(() => usePullDocumentFromNotion("page"));

    await act(() => pull.current.mutateAsync({ documentId: "page" }));

    expect(await refetched()).toEqual([
      "commentAi",
      "comments",
      "documents",
      "files",
      "pageChildren",
      "pageDoc",
      "pagePath",
      "pageProperties",
      "recent",
      "root",
      "rootPage2",
      "sectionChildren",
      "space2Root",
    ]);
  });

  it("comment delete refreshes the page's comments and comment AI requests", async () => {
    await mountReads();
    actionResponses["delete-comment"] = { ok: true };
    const remove = await renderHook(() => useDeleteComment());

    await act(() =>
      remove.current.mutateAsync({ id: "comment", documentId: "page" }),
    );

    expect(await refetched()).toEqual(["commentAi", "comments"]);
  });
});

describe("optimistic sidebar creates", () => {
  it("keep the new page's ancestors revealed until the server has the page", async () => {
    queryClient.setQueryData(keys.pagePath, path("section", "page"));
    queryClient.setQueryData(keys.sectionChildren, branch("page", "sibling"));
    const created = {
      id: "new-page",
      parentId: "page",
      title: "",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
    } as Document;

    seedCreatedDocumentNavigation(queryClient, created, FILES);

    const seeded = queryClient.getQueryData<ContentNavigationContext>(
      keys.newPath,
    );
    expect(seeded?.path.map((entry) => entry.id)).toEqual([
      "section",
      "page",
      "new-page",
    ]);
    expect(seeded?.path[2]?.databaseId).toBe(FILES);
    expect(
      queryClient
        .getQueryData<any>(keys.sectionChildren)
        .items.find(
          (item: { documentId: string }) => item.documentId === "page",
        ).hasChildren,
    ).toBe(true);

    removeCreatedDocumentNavigation(queryClient, created);

    expect(queryClient.getQueryData(keys.newPath)).toBeUndefined();
    expect(queryClient.getQueryState(keys.sectionChildren)?.isInvalidated).toBe(
      true,
    );
  });

  it("reveal a new root page through its space's Files collection", () => {
    seedCreatedDocumentNavigation(
      queryClient,
      {
        id: "new-root",
        parentId: null,
        title: "",
        createdAt: "2026-09-27T00:00:00.000Z",
        updatedAt: "2026-09-27T00:00:00.000Z",
      } as Document,
      FILES,
    );

    expect(
      queryClient.getQueryData<ContentNavigationContext>([
        "action",
        "get-content-navigation-context",
        { id: "new-root" },
      ])?.path,
    ).toEqual([
      expect.objectContaining({
        id: "new-root",
        parentId: null,
        databaseId: FILES,
      }),
    ]);
  });
});
