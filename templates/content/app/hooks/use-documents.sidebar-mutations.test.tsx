// @vitest-environment happy-dom

import type {
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
  ContentDatabaseResponse,
  Document,
} from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery: vi.fn(),
  callActionWithRetry: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => client.current,
}));

import {
  filesNavigationPageParams,
  filesNavigationQueryKey,
} from "@/lib/files-navigation";

import {
  useFirstPins,
  useMoveDocument,
  useUpdateDocument,
} from "./use-documents";
import { MOVE_DOCUMENT_MUTATION_KEY } from "./use-pending-moves";

const FILES = "files";
const SPACE = "space";

function row(
  documentId: string,
  overrides: Partial<ContentDatabaseNavigationItem> = {},
): ContentDatabaseNavigationItem {
  return {
    membershipId: `membership-${documentId}`,
    membershipPosition: 0,
    documentId,
    parentId: null,
    title: `Page ${documentId}`,
    icon: null,
    type: "page",
    hasChildren: false,
    // Rows of a space's own tree name no space; the Files collection does.
    spaceId: null,
    sourceKind: null,
    isFavorite: false,
    canEdit: true,
    canManage: true,
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
    ...overrides,
  };
}

function page(
  items: ContentDatabaseNavigationItem[],
): ContentDatabaseNavigationPageResponse {
  return { items, pagination: { limit: 20, hasMore: false, nextCursor: null } };
}

function branchKey(parentId: string | null = null) {
  return filesNavigationQueryKey(
    filesNavigationPageParams({ databaseId: FILES, parentId }),
  );
}

function ids(queryClient: QueryClient, parentId: string | null = null) {
  return (
    queryClient.getQueryData<ContentDatabaseNavigationPageResponse>(
      branchKey(parentId),
    )?.items ?? []
  ).map((item) => item.documentId);
}

function seedSpaces(
  queryClient: QueryClient,
  favoritesDatabaseId: string | null,
) {
  queryClient.setQueryData(["action", "list-content-spaces", undefined], {
    sourceMode: "database",
    favoritesDatabaseId,
    favoritesDocumentId: favoritesDatabaseId ? "favorites-page" : null,
    spaces: [{ id: SPACE, filesDatabaseId: FILES }],
  });
}

/** The options the hook hands the action mutation, as TanStack Query runs them. */
function mutationOptions(name: string) {
  const calls = useActionMutation.mock.calls.filter(
    ([action]) => action === name,
  );
  return calls[calls.length - 1]![1];
}

describe("Move to in the Files tree", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    useActionMutation.mockReset();
    useActionMutation.mockImplementation((_name, options) => options);
    queryClient = new QueryClient();
    client.current = queryClient;
    queryClient.setQueryData(branchKey(), page([row("folder"), row("page")]));
    queryClient.setQueryData(branchKey("folder"), page([]));
  });

  it("plans the move from the page's row, then draws the server's answer once the reread starts", async () => {
    useMoveDocument();
    const options = mutationOptions("move-document");
    expect(options.mutationKey).toEqual(MOVE_DOCUMENT_MUTATION_KEY);

    const variables = { id: "page", parentId: "folder" };
    const context = options.onMutate(variables);
    expect(context.move).toMatchObject({
      documentId: "page",
      databaseId: FILES,
      parentId: "folder",
      from: { databaseId: FILES, parentId: null },
    });

    options.onSuccess({ id: "page" }, variables, context);
    // The reread found the branch that listed the page and the new parent's.
    const invalidated = (key: QueryKey) =>
      queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state
        .isInvalidated;
    expect(invalidated(branchKey())).toBe(true);
    expect(invalidated(branchKey("folder"))).toBe(true);

    options.onSettled({ id: "page" }, null, variables, context);
    expect(ids(queryClient)).toEqual(["folder"]);
    expect(ids(queryClient, "folder")).toEqual(["page"]);
    expect(invalidated(branchKey())).toBe(true);
  });

  it("leaves the cached tree as it was when the move fails", () => {
    useMoveDocument();
    const options = mutationOptions("move-document");
    const variables = { id: "page", parentId: "folder" };
    const context = options.onMutate(variables);

    options.onSettled(undefined, new Error("refused"), variables, context);

    expect(ids(queryClient)).toEqual(["folder", "page"]);
    expect(ids(queryClient, "folder")).toEqual([]);
  });

  it("plans nothing for a move that keeps the page's parent, or into a space it can't place", () => {
    useMoveDocument();
    const options = mutationOptions("move-document");
    expect(options.onMutate({ id: "page", position: 0 })).toEqual({});
    expect(
      options.onMutate({ id: "page", parentId: null, spaceId: "unknown" }),
    ).toEqual({});
  });
});

function favoritesDatabase(items: ContentDatabaseResponse["items"] = []) {
  return {
    database: {
      id: "favorites",
      documentId: "favorites-page",
      title: "Favorites",
      systemRole: "favorites",
      viewConfig: { activeViewId: "default", views: [] },
      createdAt: "2026-11-16T00:00:00.000Z",
      updatedAt: "2026-11-16T00:00:00.000Z",
    },
    properties: [],
    items,
    source: null,
  } as unknown as ContentDatabaseResponse;
}

const favoritesKey = [
  "action",
  "get-content-database",
  { databaseId: "favorites", limit: 50, contentSpaceId: SPACE },
] as const;

describe("pinning from the hosted Files tree", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    useActionMutation.mockReset();
    useActionMutation.mockImplementation((_name, options) => options);
    queryClient = new QueryClient();
    client.current = queryClient;
    // A hosted sidebar loads no page list: the page is only a Files row.
    queryClient.setQueryData(branchKey(), page([row("page")]));
  });

  it("draws the page in an empty Pinned list at once, from its Files row", async () => {
    seedSpaces(queryClient, "favorites");
    queryClient.setQueryData(favoritesKey, favoritesDatabase());
    useUpdateDocument();
    const options = mutationOptions("update-document");

    const context = await options.onMutate({ id: "page", isFavorite: true });

    const favorites =
      queryClient.getQueryData<ContentDatabaseResponse>(favoritesKey);
    expect(favorites?.items.map((item) => item.document.id)).toEqual(["page"]);
    expect(favorites?.items[0]?.document).toMatchObject({
      title: "Page page",
      isFavorite: true,
    });
    expect(context).toMatchObject({ createsFavorites: false });
    expect(context.firstPin).toBeUndefined();

    options.onError(
      new Error("refused"),
      { id: "page", isFavorite: true },
      context,
    );
    expect(
      queryClient
        .getQueryData<ContentDatabaseResponse>(favoritesKey)
        ?.items.map((item) => item.document.id),
    ).toEqual([]);
  });

  it("hands a first pin to Pinned when there is no Favorites collection yet, and rereads the spaces list after it", async () => {
    seedSpaces(queryClient, null);
    useUpdateDocument();
    const options = mutationOptions("update-document");
    const variables = { id: "page", isFavorite: true };

    const context = await options.onMutate(variables);

    expect(context).toMatchObject({
      createsFavorites: true,
      firstPin: { id: "page", title: "Page page", isFavorite: true },
    });

    options.onSuccess(
      {
        id: "page",
        isFavorite: true,
        updatedAt: "2026-11-16T00:00:01.000Z",
        softDeletedDatabaseIds: [],
      },
      variables,
      context,
    );
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: ["action", "list-content-spaces"] })?.state
        .isInvalidated,
    ).toBe(true);
  });
});

describe("useFirstPins", () => {
  const pinned = (id: string) =>
    ({
      id,
      parentId: null,
      title: id,
      content: "",
      icon: null,
      position: 0,
      isFavorite: true,
      hideFromSearch: false,
      createdAt: "2026-11-16T00:00:00.000Z",
      updatedAt: "2026-11-16T00:00:00.000Z",
    }) satisfies Document;

  it("holds first pins newest first until the page is unpinned or its pin fails", async () => {
    const queryClient = new QueryClient();
    const seen = { current: [] as string[] };
    function Probe() {
      const ids = useFirstPins().map((document) => document.id);
      useEffect(() => {
        seen.current = ids;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    const answers: Array<{
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    const toggle = (id: string, isFavorite: boolean, firstPin = isFavorite) =>
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationKey: ["content", "update-document"],
          mutationFn: () =>
            new Promise<void>((resolve, reject) =>
              answers.push({ resolve, reject }),
            ),
          onMutate: () => (firstPin ? { firstPin: pinned(id) } : {}),
        })
        .execute({ id, isFavorite })
        .catch(() => {});
    const settle = async () =>
      act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

    void toggle("a", true);
    void toggle("b", true);
    await settle();
    expect(seen.current).toEqual(["b", "a"]);

    // A's pin lands; B's fails.
    answers[0]!.resolve();
    answers[1]!.reject(new Error("refused"));
    await settle();
    expect(seen.current).toEqual(["a"]);

    void toggle("a", false);
    await settle();
    expect(seen.current).toEqual([]);

    await act(async () => root.unmount());
  });
});
