import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  cachedFilesRootDocumentIds,
  filesNavigationPageParams,
  filesNavigationQueryKey,
} from "./files-navigation";

function rows(...documentIds: string[]) {
  return {
    items: documentIds.map((documentId) => ({ documentId })),
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  };
}

describe("cachedFilesRootDocumentIds", () => {
  it("lists cached top-level rows, the tree holding the page first", () => {
    const queryClient = new QueryClient();
    const key = (
      databaseId: string,
      parentId: string | null,
      cursor?: string,
    ) =>
      filesNavigationQueryKey(
        filesNavigationPageParams({ databaseId, parentId, cursor }),
      );
    queryClient.setQueryData(key("team", null), rows("roadmap", "hiring"));
    queryClient.setQueryData(key("personal", null), rows("journal", "draft"));
    queryClient.setQueryData(key("personal", "journal"), rows("monday"));
    queryClient.setQueryData(key("personal", null, "page-2"), rows("later"));
    queryClient.setQueryData(key("archive", null), { available: false });

    expect(cachedFilesRootDocumentIds(queryClient, "draft")).toEqual([
      "journal",
      "draft",
      "roadmap",
      "hiring",
    ]);
    expect(cachedFilesRootDocumentIds(new QueryClient(), "draft")).toEqual([]);
  });
});
