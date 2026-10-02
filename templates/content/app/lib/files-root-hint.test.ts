// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAction } = vi.hoisted(() => ({
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import {
  filesNavigationPageParams,
  filesNavigationQueryKey,
  readFilesNavigationPage,
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
          expand: ["folder-a", "folder-b"],
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

  it("leaves open folders to refresh themselves when a page reads again", async () => {
    const queryClient = new QueryClient();
    const params = filesNavigationPageParams({
      databaseId: "files-1",
      parentId: null,
    });
    queryClient.setQueryData(filesNavigationQueryKey(params), page(["kept"]));
    callAction.mockResolvedValue(page(["fresh"]));

    await readFilesNavigationPage(queryClient, params, new Set(["folder-a"]));

    expect(callAction).toHaveBeenCalledWith(
      "query-content-database-items",
      params,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
