// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAction } = vi.hoisted(() => ({
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import { filesNavigationPageParams } from "./files-navigation";
import {
  filesRootHintScope,
  prefetchPagedFilesRoot,
  readPagedFilesRootHint,
  rememberPagedFilesRoot,
} from "./files-root-hint";

describe("Files root hint", () => {
  beforeEach(() => {
    localStorage.clear();
    callAction.mockReset();
  });

  it("returns the last confirmed root inputs only for the same account and organization", () => {
    const scope = filesRootHintScope(" Owner@Example.test ", "org-a")!;
    rememberPagedFilesRoot(scope, {
      databaseId: "files-1",
      sort: "last_edited",
      viewId: "default",
    });

    expect(
      readPagedFilesRootHint(
        filesRootHintScope("owner@example.test", "org-a")!,
      ),
    ).toEqual({
      databaseId: "files-1",
      sort: "last_edited",
      viewId: "default",
    });
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
    callAction.mockResolvedValue({ items: [] });
    const queryClient = new QueryClient();

    prefetchPagedFilesRoot(queryClient, {
      databaseId: "files-1",
      sort: "custom",
      viewId: "default",
    });

    const treeArgs = filesNavigationPageParams({
      databaseId: "files-1",
      parentId: null,
      sort: "custom",
      viewId: "default",
      cursor: undefined,
    });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData([
          "action",
          "query-content-database-items",
          treeArgs,
        ]),
      ).toEqual({ items: [] }),
    );
    expect(callAction).toHaveBeenCalledWith(
      "query-content-database-items",
      treeArgs,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
