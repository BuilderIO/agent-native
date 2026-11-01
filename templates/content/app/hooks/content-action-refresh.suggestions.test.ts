import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

function decisionEvent(key: string, documentId: string) {
  return {
    source: "action",
    type: "change",
    key,
    owner: "owner@example.com",
    resourceType: "document",
    resourceId: documentId,
  };
}

function mount(queryClient: QueryClient, queryKey: readonly unknown[]) {
  let version = 1;
  const queryFn = vi.fn(async () => ({ version: version++ }));
  const observer = new QueryObserver(queryClient, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  return { observer, queryFn, unsubscribe };
}

describe("a decision on a suggestion", () => {
  it.each([
    "decide-resource-suggestion",
    "decide-resource-suggestion-proposal",
  ])(
    "%s reads the open Page's tabs again, since accepting one writes its tab, and leaves its comments alone",
    async (key) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const properties = mount(queryClient, [
        "action",
        "list-document-properties",
        { documentId: "page-1", databaseId: "collection-1" },
      ]);
      const comments = mount(queryClient, [
        "action",
        "list-comments",
        { documentId: "page-1" },
      ]);
      try {
        await properties.observer.refetch();
        await comments.observer.refetch();
        const propertyReads = properties.queryFn.mock.calls.length;
        const commentReads = comments.queryFn.mock.calls.length;
        const predicate = contentActionInvalidatePredicate("/page/page-1");
        await queryClient.invalidateQueries({
          predicate: (query) =>
            predicate(query, [decisionEvent(key, "page-1")]),
        });

        expect(properties.queryFn).toHaveBeenCalledTimes(propertyReads + 1);
        expect(comments.queryFn).toHaveBeenCalledTimes(commentReads);
      } finally {
        properties.unsubscribe();
        comments.unsubscribe();
        queryClient.clear();
      }
    },
  );
});
