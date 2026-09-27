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

import { useContentActionMutation } from "./use-content-action-mutation";
import {
  removeCreatedDocumentNavigation,
  seedCreatedDocumentNavigation,
  useCreateDocument,
  useMoveDocument,
  useUpdateDocument,
} from "./use-documents";

const FILES = "files-db";

const keys = {
  root: [
    "action",
    "query-content-database-items",
    { databaseId: FILES, limit: 20, navigation: { parentId: null } },
  ],
  sectionChildren: [
    "action",
    "query-content-database-items",
    { databaseId: FILES, limit: 20, navigation: { parentId: "section" } },
  ],
  pageChildren: [
    "action",
    "query-content-database-items",
    { databaseId: FILES, limit: 20, navigation: { parentId: "page" } },
  ],
  otherChildren: [
    "action",
    "query-content-database-items",
    { databaseId: FILES, limit: 20, navigation: { parentId: "other" } },
  ],
  pagePath: ["action", "get-content-navigation-context", { id: "page" }],
  otherPath: ["action", "get-content-navigation-context", { id: "other" }],
  newPath: ["action", "get-content-navigation-context", { id: "new-page" }],
  recent: ["action", "get-content-recent", { spaceId: "space" }],
  files: ["action", "get-content-database", { databaseId: FILES }],
  documents: ["action", "list-documents", undefined],
  comments: ["action", "list-comments", { documentId: "page" }],
  spaces: ["action", "list-content-spaces", undefined],
} satisfies Record<string, QueryKey>;

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

const seed: Partial<Record<keyof typeof keys, unknown>> = {
  root: branch("section", "other"),
  sectionChildren: branch("page", "sibling"),
  pageChildren: branch(),
  otherChildren: branch("other-child"),
  pagePath: path("section", "page"),
  otherPath: path("other"),
  recent: {
    entries: [{ target: { documentId: "page" }, title: "page" }],
  },
  files: { database: { id: FILES }, items: [] },
  documents: { documents: [] },
  comments: { comments: [] },
  spaces: {
    spaces: [{ id: "space", filesDatabaseId: FILES }],
  },
};

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;
let reads: Map<keyof typeof keys, ReturnType<typeof vi.fn>>;
let unsubscribes: Array<() => void>;
let actionResponses: Record<string, unknown>;

/** Mount reads as active observers, then count only the fetches that follow. */
async function mountReads(
  names = Object.keys(keys) as Array<keyof typeof keys>,
) {
  for (const name of names) {
    const queryFn = vi.fn(async () => seed[name] ?? null);
    reads.set(name, queryFn);
    if (seed[name] !== undefined)
      queryClient.setQueryData(keys[name], seed[name]);
    const observer = new QueryObserver(queryClient, {
      queryKey: keys[name],
      queryFn,
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
  it("rename refreshes the renamed row's branch and its path", async () => {
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

    expect(await refetched()).toEqual(["pagePath", "sectionChildren"]);
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
    const otherRoot = [
      "action",
      "query-content-database-items",
      { databaseId: "other-files", limit: 20, navigation: { parentId: null } },
    ];
    await mountReads(["root", "sectionChildren", "spaces"]);
    const otherRootRead = vi.fn(async () => branch());
    queryClient.setQueryData(otherRoot, branch());
    unsubscribes.push(
      new QueryObserver(queryClient, {
        queryKey: otherRoot,
        queryFn: otherRootRead,
        staleTime: Infinity,
      }).subscribe(() => {}),
    );
    actionResponses["create-document"] = {
      id: "new-page",
      parentId: null,
      spaceId: "space",
      title: "",
    };
    const create = await renderHook(() => useCreateDocument());

    await act(() => create.current.mutateAsync({ id: "new-page" }));

    expect(await refetched()).toEqual(["root"]);
    expect(otherRootRead).not.toHaveBeenCalled();
  });

  it("move refreshes the old branch, the new parent's children and row, and the moved page's path", async () => {
    await mountReads();
    actionResponses["move-document"] = { id: "sibling", parentId: "other" };
    const move = await renderHook(() => useMoveDocument());

    await act(() =>
      move.current.mutateAsync({ id: "sibling", parentId: "other" }),
    );

    expect(await refetched()).toEqual([
      "documents",
      "otherChildren",
      "root",
      "sectionChildren",
    ]);
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

    expect(
      queryClient
        .getQueryData<ContentNavigationContext>(keys.newPath)
        ?.path.map((entry) => entry.id),
    ).toEqual(["section", "page", "new-page"]);
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
});
