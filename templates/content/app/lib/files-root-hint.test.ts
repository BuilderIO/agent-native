// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAction } = vi.hoisted(() => ({
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import {
  pagedFilesNavigationArgs,
  prefetchPagedFilesRoot,
  readPagedFilesRootHint,
  rememberPagedFilesRoot,
} from "./files-root-hint";

describe("Files root hint", () => {
  beforeEach(() => {
    localStorage.clear();
    callAction.mockReset();
  });

  it("returns the last confirmed root inputs only for the same account", () => {
    rememberPagedFilesRoot("owner@example.test", {
      databaseId: "files-1",
      sort: "last_edited",
      viewId: "default",
    });

    expect(readPagedFilesRootHint("owner@example.test")).toEqual({
      databaseId: "files-1",
      sort: "last_edited",
      viewId: "default",
    });
    expect(readPagedFilesRootHint("someone-else@example.test")).toBeNull();
  });

  it("ignores a missing or malformed hint", () => {
    expect(readPagedFilesRootHint("owner@example.test")).toBeNull();
    localStorage.setItem("content-sidebar-files-root-v1", "{not json");
    expect(readPagedFilesRootHint("owner@example.test")).toBeNull();
    localStorage.setItem(
      "content-sidebar-files-root-v1",
      JSON.stringify({ accountId: "owner@example.test", sort: "name" }),
    );
    expect(readPagedFilesRootHint("owner@example.test")).toBeNull();
  });

  it("starts the root page under the key the tree reads", async () => {
    callAction.mockResolvedValue({ items: [] });
    const queryClient = new QueryClient();

    prefetchPagedFilesRoot(queryClient, {
      databaseId: "files-1",
      sort: "custom",
      viewId: "default",
    });

    const treeArgs = pagedFilesNavigationArgs({
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
