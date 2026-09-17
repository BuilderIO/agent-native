import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionMutation = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation,
  useActionQuery: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual("@tanstack/react-query")),
  useQueryClient,
}));

import { useUpdateDocument } from "./use-documents";

describe("title changes and database query membership", () => {
  beforeEach(() => {
    useActionMutation.mockReset();
    useQueryClient.mockReset();
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
});
