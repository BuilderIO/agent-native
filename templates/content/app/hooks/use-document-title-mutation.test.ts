import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery: vi.fn(),
  callAction: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast }));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

import { LIST_DOCUMENTS_QUERY_KEY, useUpdateDocument } from "./use-documents";

describe("title changes and database query membership", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useQueryClient.mockReset();
    toast.mockClear();
    toast.error.mockClear();
    useActionMutation.mockImplementation((_name, options) => options);
  });

  it.each(["saved", "conflict"])(
    "refreshes excluded rows after a %s title result without refetching inactive or unconstrained data",
    async (result) => {
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      });
      useQueryClient.mockReturnValue(client);
      const newRow = {
        id: "item-1",
        document: { id: "row-1", title: "New matching title" },
      };
      const returnedPage = { items: [newRow] };
      const boundedKey = [
        "action",
        "query-content-database-items",
        { documentId: "database-page", tableQuery: { search: "matching" } },
      ];
      const legacyKey = [
        "action",
        "get-content-database",
        { documentId: "database-page", tableQuery: { search: "matching" } },
      ];
      const inactiveKey = [
        "action",
        "query-content-database-items",
        { documentId: "another-database", tableQuery: { search: "matching" } },
      ];
      const metadataKey = [
        "action",
        "get-content-database",
        { documentId: "database-page" },
      ];
      const reads = [boundedKey, legacyKey, inactiveKey, metadataKey].map(
        (queryKey) => {
          const queryFn = vi.fn(async () => returnedPage);
          client.setQueryData(queryKey, { items: [] });
          const observer = new QueryObserver(client, { queryKey, queryFn });
          return { queryKey, queryFn, observer };
        },
      );
      const subscriptions = [reads[0], reads[1], reads[3]].map(({ observer }) =>
        observer.subscribe(() => {}),
      );

      try {
        useUpdateDocument();
        const mutation = useActionMutation.mock.calls.find(
          ([name]) => name === "update-document",
        )![1];
        const savedDocument = {
          id: "row-1",
          title: "New matching title",
          softDeletedDatabaseIds: [],
        };
        mutation.onSuccess(
          result === "conflict"
            ? { conflict: true, id: "row-1", document: savedDocument }
            : savedDocument,
          { id: "row-1", title: "New matching title" },
          undefined,
        );

        await vi.waitFor(() => {
          expect(client.getQueryData(boundedKey)).toEqual(returnedPage);
          expect(client.getQueryData(legacyKey)).toEqual(returnedPage);
        });
        expect(reads[0].queryFn).toHaveBeenCalledTimes(1);
        expect(reads[1].queryFn).toHaveBeenCalledTimes(1);
        expect(reads[2].queryFn).not.toHaveBeenCalled();
        expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
        expect(reads[3].queryFn).not.toHaveBeenCalled();
        expect(client.getQueryState(metadataKey)?.isInvalidated).toBe(false);
      } finally {
        subscriptions.forEach((unsubscribe) => unsubscribe());
        client.clear();
      }
    },
  );

  it("optimistically patches loaded navigation and Recent titles, then invalidates both", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    useQueryClient.mockReturnValue(client);
    const navigationKey = [
      "action",
      "query-content-database-items",
      { databaseId: "files", navigation: { parentId: null } },
    ];
    const recentKey = ["action", "get-content-recent", { scopeKey: "user" }];
    const navigationContextKey = [
      "action",
      "get-content-navigation-context",
      { id: "row-1" },
    ];
    client.setQueryData(navigationKey, {
      items: [{ documentId: "row-1", title: "Untitled" }],
    });
    client.setQueryData(recentKey, {
      scopeKey: "user",
      entries: [
        {
          target: { documentId: "row-1" },
          visitedAt: "2026-09-14T00:00:00.000Z",
          title: "Untitled",
          icon: null,
          viewName: null,
        },
      ],
    });
    client.setQueryData(navigationContextKey, {
      document: { id: "row-1", title: "Untitled" },
      path: [{ id: "row-1", title: "Untitled" }],
    });

    useUpdateDocument();
    const mutation = useActionMutation.mock.calls.find(
      ([name]) => name === "update-document",
    )![1];
    const context = await mutation.onMutate({
      id: "row-1",
      title: "Renamed page",
    });

    expect(client.getQueryData<any>(navigationKey).items[0].title).toBe(
      "Renamed page",
    );
    expect(client.getQueryData<any>(recentKey).entries[0].title).toBe(
      "Renamed page",
    );
    expect(client.getQueryData<any>(navigationContextKey).path[0].title).toBe(
      "Renamed page",
    );

    mutation.onSuccess(
      {
        id: "row-1",
        title: "Renamed page",
        softDeletedDatabaseIds: [],
      },
      { id: "row-1", title: "Renamed page" },
      context,
    );

    expect(client.getQueryState(navigationKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(recentKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(navigationContextKey)?.isInvalidated).toBe(
      true,
    );
    client.clear();
  });

  it("restores hidden Pinned from click-time sidebar state and rolls back a failed save", async () => {
    const client = new QueryClient();
    useQueryClient.mockReturnValue(client);
    const saveSidebarState = vi.fn().mockRejectedValue(new Error("failed"));
    useActionMutation.mockImplementation((name, options) =>
      name === "update-content-sidebar-state"
        ? { mutateAsync: saveSidebarState }
        : options,
    );
    const sidebarKey = [
      "action",
      "get-content-sidebar-state",
      { spaceId: "space-a" },
    ] as const;
    const unrelatedSidebarKey = [
      "action",
      "get-content-sidebar-state",
      { spaceId: "space-b" },
    ] as const;
    const hiddenState = {
      state: {
        version: 2 as const,
        sections: {
          order: ["pinned", "recent", "workspaces"],
          pinned: { visible: false, expanded: false, limit: 5 },
          recent: { visible: true, expanded: true, limit: 5 },
        },
      },
    };
    client.setQueryData(sidebarKey, hiddenState);
    client.setQueryData(unrelatedSidebarKey, {
      state: {
        ...hiddenState.state,
        sections: {
          ...hiddenState.state.sections,
          pinned: { visible: true, expanded: false, limit: 5 },
        },
      },
    });
    client.setQueryData(LIST_DOCUMENTS_QUERY_KEY, [
      { id: "row-1", spaceId: "space-a" },
    ]);
    const favoritesResponse = {
      database: {
        id: "favorites",
        systemRole: "favorites",
        viewConfig: { activeViewId: "default" },
      },
      items: [],
    };
    const favoritesAKey = [
      "action",
      "get-content-database",
      { databaseId: "favorites", contentSpaceId: "space-a" },
    ] as const;
    const favoritesBKey = [
      "action",
      "get-content-database",
      { databaseId: "favorites", contentSpaceId: "space-b" },
    ] as const;
    client.setQueryData(favoritesAKey, favoritesResponse);
    client.setQueryData(favoritesBKey, favoritesResponse);

    useUpdateDocument();
    const mutation = useActionMutation.mock.calls.find(
      ([name]) => name === "update-document",
    )![1];
    const context = await mutation.onMutate({ id: "row-1", isFavorite: true });
    expect(client.getQueryData<any>(favoritesAKey).items).toHaveLength(1);
    expect(client.getQueryData<any>(favoritesBKey).items).toHaveLength(0);
    mutation.onSuccess(
      {
        id: "row-1",
        isFavorite: true,
        softDeletedDatabaseIds: [],
      },
      { id: "row-1", isFavorite: true },
      context,
    );
    const action = toast.mock.calls[0]![1].action;
    const newerState = {
      state: {
        ...hiddenState.state,
        sections: {
          ...hiddenState.state.sections,
          recent: { visible: false, expanded: false, limit: 10 },
        },
      },
    };
    client.setQueryData(sidebarKey, newerState);

    action.onClick();
    expect(client.getQueryData<any>(sidebarKey).state.sections).toEqual({
      ...newerState.state.sections,
      pinned: { visible: true, expanded: true, limit: 5 },
    });
    expect(saveSidebarState).toHaveBeenCalledWith({
      version: 2,
      spaceId: "space-a",
      sectionsPatch: { pinned: { visible: true, expanded: true } },
    });
    await vi.waitFor(() => {
      expect(client.getQueryData(sidebarKey)).toEqual(newerState);
      expect(toast.error).toHaveBeenCalledWith(
        "sidebar.failedSaveSidebarState",
      );
    });
    expect(action.label).toBe("editor.properties.show");
    expect(
      client.getQueryData<any>(unrelatedSidebarKey).state.sections.pinned,
    ).toEqual({ visible: true, expanded: false, limit: 5 });
    client.clear();
  });
});
