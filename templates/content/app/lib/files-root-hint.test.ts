// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAction } = vi.hoisted(() => ({
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import {
  filesNavigationPageParams,
  filesNavigationQueryKey,
  openFilesFolderIds,
  readFilesNavigationPage,
  useFilesNavigationPage,
} from "./files-navigation";
import {
  filesRootHintScope,
  prefetchPagedFilesRoot,
  readPagedFilesRootHint,
  rememberPagedFilesRoot,
} from "./files-root-hint";

function page(ids: string[]) {
  return {
    items: ids.map((documentId) => ({ documentId })),
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  };
}

describe("Files root hint", () => {
  beforeEach(() => {
    localStorage.clear();
    callAction.mockReset();
  });

  it("returns the last confirmed root only for the same account and organization", () => {
    const scope = filesRootHintScope(" Owner@Example.test ", "org-a")!;
    rememberPagedFilesRoot(scope, { databaseId: "files-1" });

    expect(
      readPagedFilesRootHint(
        filesRootHintScope("owner@example.test", "org-a")!,
      ),
    ).toEqual({ databaseId: "files-1" });
    expect(
      readPagedFilesRootHint(
        filesRootHintScope("owner@example.test", "org-b")!,
      ),
    ).toBeNull();
    expect(
      readPagedFilesRootHint(filesRootHintScope("owner@example.test", null)!),
    ).toBeNull();
    expect(
      readPagedFilesRootHint(
        filesRootHintScope("someone@example.test", "org-a")!,
      ),
    ).toBeNull();
    expect(filesRootHintScope(undefined, "org-a")).toBeNull();
  });

  it("reads a hint written with the order it used to carry", () => {
    const scope = filesRootHintScope("owner@example.test", "org-a")!;
    localStorage.setItem(
      "content-sidebar-files-root-v1",
      JSON.stringify({
        scope,
        databaseId: "files-1",
        sort: "last_edited",
        viewId: "default",
      }),
    );
    expect(readPagedFilesRootHint(scope)).toEqual({ databaseId: "files-1" });
  });

  it("ignores a missing or malformed hint", () => {
    const scope = filesRootHintScope("owner@example.test", "org-a")!;
    expect(readPagedFilesRootHint(scope)).toBeNull();
    localStorage.setItem("content-sidebar-files-root-v1", "{not json");
    expect(readPagedFilesRootHint(scope)).toBeNull();
    localStorage.setItem(
      "content-sidebar-files-root-v1",
      JSON.stringify({ scope, sort: "name" }),
    );
    expect(readPagedFilesRootHint(scope)).toBeNull();
  });

  it("starts the root page under the key the tree reads", async () => {
    callAction.mockResolvedValue(page([]));
    const queryClient = new QueryClient();

    prefetchPagedFilesRoot(queryClient, { databaseId: "files-1" });

    const treeArgs = filesNavigationPageParams({
      databaseId: "files-1",
      parentId: null,
    });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData(filesNavigationQueryKey(treeArgs)),
      ).toEqual(page([])),
    );
    expect(callAction).toHaveBeenCalledWith(
      "query-content-database-items",
      treeArgs,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("caches open folders' pages from the root read under their own keys", async () => {
    const queryClient = new QueryClient();
    const branchKey = (parentId: string) =>
      filesNavigationQueryKey(
        filesNavigationPageParams({ databaseId: "files-1", parentId }),
      );
    // A folder the tree already read keeps that page.
    queryClient.setQueryData(branchKey("folder-b"), page(["b-kept"]));
    callAction.mockResolvedValue({
      ...page(["folder-a", "folder-b"]),
      branches: {
        "folder-a": page(["a-1", "a-2"]),
        "folder-b": page(["b-new"]),
      },
    });

    prefetchPagedFilesRoot(queryClient, { databaseId: "files-1" }, [
      "folder-a",
      "folder-b",
    ]);

    const rootKey = filesNavigationQueryKey(
      filesNavigationPageParams({ databaseId: "files-1", parentId: null }),
    );
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(rootKey)).toEqual(
        page(["folder-a", "folder-b"]),
      ),
    );
    expect(callAction).toHaveBeenCalledWith(
      "query-content-database-items",
      {
        databaseId: "files-1",
        limit: 20,
        navigation: {
          parentId: null,
          cursor: undefined,
          expand: ["folder-a"],
        },
      },
      expect.objectContaining({ method: "GET" }),
    );
    expect(queryClient.getQueryData(branchKey("folder-a"))).toEqual(
      page(["a-1", "a-2"]),
    );
    expect(queryClient.getQueryData(branchKey("folder-b"))).toEqual(
      page(["b-kept"]),
    );
  });

  it("requests newly opened branches even when the root page is cached", async () => {
    const queryClient = new QueryClient();
    const params = filesNavigationPageParams({
      databaseId: "files-1",
      parentId: null,
    });
    queryClient.setQueryData(filesNavigationQueryKey(params), page(["kept"]));
    callAction.mockResolvedValue({
      ...page(["fresh"]),
      branches: { "folder-a": page(["child-a"]) },
    });

    await readFilesNavigationPage(queryClient, params, new Set(["folder-a"]));

    expect(callAction).toHaveBeenCalledWith(
      "query-content-database-items",
      {
        ...params,
        navigation: { ...params.navigation, expand: ["folder-a"] },
      },
      expect.objectContaining({ method: "GET" }),
    );
    expect(
      queryClient.getQueryData(
        filesNavigationQueryKey(
          filesNavigationPageParams({
            databaseId: "files-1",
            parentId: "folder-a",
          }),
        ),
      ),
    ).toEqual(page(["child-a"]));
  });

  it("refetches a fresh root when a new expanded branch has no cached page", async () => {
    const queryClient = new QueryClient();
    const params = filesNavigationPageParams({
      databaseId: "files-1",
      parentId: null,
    });
    callAction.mockResolvedValue(page(["root"]));

    const container = document.createElement("div");
    const root = createRoot(container);
    function Observer({ expanded }: { expanded: string[] }) {
      useFilesNavigationPage(params, new Set(expanded));
      return null;
    }

    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Observer, { expanded: [] }),
          ),
        );
      });
      await vi.waitFor(() => expect(callAction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(
          queryClient.getQueryData(filesNavigationQueryKey(params)),
        ).toEqual(page(["root"])),
      );

      callAction.mockResolvedValue({
        ...page(["root"]),
        branches: { "folder-new": page(["child-new"]) },
      });
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Observer, { expanded: ["folder-new"] }),
          ),
        );
      });

      await vi.waitFor(() => expect(callAction).toHaveBeenCalledTimes(2));
      expect(callAction).toHaveBeenLastCalledWith(
        "query-content-database-items",
        {
          ...params,
          navigation: { ...params.navigation, expand: ["folder-new"] },
        },
        expect.objectContaining({ method: "GET" }),
      );
      expect(
        queryClient.getQueryData(
          filesNavigationQueryKey(
            filesNavigationPageParams({
              databaseId: "files-1",
              parentId: "folder-new",
            }),
          ),
        ),
      ).toEqual(page(["child-new"]));
    } finally {
      await act(async () => root.unmount());
      container.remove();
      queryClient.clear();
    }
  });

  it("asks for the open page's ancestors first when more folders are open than one read takes", async () => {
    const queryClient = new QueryClient();
    const params = filesNavigationPageParams({
      databaseId: "files-1",
      parentId: null,
    });
    const expanded = Array.from(
      { length: 120 },
      (_, index) => `expanded-${index}`,
    );
    callAction.mockResolvedValue({ ...page([]), branchesTruncated: true });

    const read = await readFilesNavigationPage(
      queryClient,
      params,
      openFilesFolderIds(["ancestor-a", "ancestor-b"], expanded),
    );

    const [, sent] = callAction.mock.calls[0]!;
    const expand = (sent as { navigation: { expand: string[] } }).navigation
      .expand;
    expect(expand).toHaveLength(100);
    expect(expand.slice(0, 2)).toEqual(["ancestor-a", "ancestor-b"]);
    expect(read).toEqual(page([]));
  });
});
