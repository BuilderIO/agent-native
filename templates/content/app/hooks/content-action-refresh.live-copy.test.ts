import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

// The event the live-body sweep sends after it switches a page, as
// `announceConversion` builds it.
function sweepConversionEvent(documentId: string) {
  return {
    source: "action",
    type: "change",
    key: "update-document",
    owner: "owner@example.com",
    resourceType: "document",
    resourceId: documentId,
  };
}

async function refreshFor(
  queryClient: QueryClient,
  pathname: string,
  events: ReturnType<typeof sweepConversionEvent>[],
) {
  const predicate = contentActionInvalidatePredicate(pathname);
  await queryClient.invalidateQueries({
    predicate: (query) => predicate(query, events),
  });
}

function mount(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  meta?: Record<string, unknown>,
) {
  let version = 1;
  const queryFn = vi.fn(async () => ({ version: version++ }));
  const observer = new QueryObserver(queryClient, { queryKey, queryFn, meta });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, queryFn, unsubscribe };
}

describe("a live-body sweep conversion", () => {
  it("refetches the rows of a mounted collection that lists the page, and leaves an unrelated collection's cached rows alone", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const collection = mount(queryClient, [
      "action",
      "query-content-database-items",
      { documentId: "collection-1", limit: 50, tableQuery: {} },
    ]);
    const unrelatedKey = [
      "action",
      "query-content-database-items",
      { documentId: "collection-2", limit: 50, tableQuery: {} },
    ];
    const unrelatedFn = vi.fn(async () => ({ version: 1 }));
    try {
      await collection.observer.refetch();
      await queryClient.fetchQuery({
        queryKey: unrelatedKey,
        queryFn: unrelatedFn,
      });

      await refreshFor(queryClient, "/page/collection-1", [
        sweepConversionEvent("page-1"),
        sweepConversionEvent("collection-1"),
      ]);

      expect(collection.queryFn).toHaveBeenCalledTimes(2);
      expect(collection.observer.getCurrentResult().data).toEqual({
        version: 2,
      });
      expect(unrelatedFn).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(
        false,
      );
    } finally {
      collection.unsubscribe();
      queryClient.clear();
    }
  });

  it.each(["/page/page-3", "/home"])(
    "refetches the mounted Files tree on %s, and leaves an unrelated page's cached read alone",
    async (pathname) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const filesTree = mount(
        queryClient,
        [
          "action",
          "query-content-database-items",
          { databaseId: "personal-files", navigation: { parentId: null } },
        ],
        { contentDatabaseSystemRole: "files" },
      );
      const unrelatedKey = ["action", "get-document", { id: "page-2" }];
      const unrelatedFn = vi.fn(async () => ({ version: 1 }));
      try {
        await filesTree.observer.refetch();
        await queryClient.fetchQuery({
          queryKey: unrelatedKey,
          queryFn: unrelatedFn,
        });

        await refreshFor(queryClient, pathname, [
          sweepConversionEvent("page-1"),
        ]);

        expect(filesTree.queryFn).toHaveBeenCalledTimes(2);
        expect(filesTree.observer.getCurrentResult().data).toEqual({
          version: 2,
        });
        expect(unrelatedFn).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(
          false,
        );
      } finally {
        filesTree.unsubscribe();
        queryClient.clear();
      }
    },
  );
});
