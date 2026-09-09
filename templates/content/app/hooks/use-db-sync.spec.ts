import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  contentActionInvalidatePredicate,
  contentDocumentIdFromPathname,
} from "./content-action-refresh";

describe("contentActionInvalidatePredicate", () => {
  it.each([
    "create-resource-suggestion",
    "update-resource-suggestion",
    "decide-resource-suggestion",
  ])("refreshes current-document suggestions after %s", (action) => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-resource-suggestions",
            { resourceType: "document", resourceId: "document-1" },
          ],
        },
        [{ source: "action", key: action }],
      ),
    ).toBe(true);
  });

  it.each([
    "create-resource-suggestion",
    "decide-resource-suggestion",
    "create-review-comment",
    "reply-review-comment",
    "resolve-review-thread",
    "delete-review-comment",
    "consume-review-feedback",
    "send-review-thread-to-agent",
    "set-review-status",
    "react-to-review-comment",
    "set-review-thread-unread",
    "set-review-thread-muted",
  ])("refreshes current-document review comments after %s", (action) => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-review-comments",
            {
              resourceType: "document",
              resourceId: "document-1",
              targetId: "suggestion-1",
            },
          ],
        },
        [{ source: "action", key: action }],
      ),
    ).toBe(true);
  });

  it("keeps review queries scoped to the current document resource", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    const event = [{ source: "action", key: "decide-resource-suggestion" }];
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-resource-suggestions",
            { resourceType: "document", resourceId: "document-2" },
          ],
        },
        event,
      ),
    ).toBe(false);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-review-comments",
            { resourceType: "design", resourceId: "document-1" },
          ],
        },
        event,
      ),
    ).toBe(false);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-resource-suggestions",
            { resourceType: "document", resourceId: "document-1" },
          ],
        },
        [{ source: "action", key: "refresh-notion-sync-status" }],
      ),
    ).toBe(false);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-resource-suggestions",
            { resourceType: "document", resourceId: "document-1" },
          ],
        },
        [{ source: "action", key: "reply-review-comment" }],
      ),
    ).toBe(false);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-review-comments",
            { resourceType: "document", resourceId: "document-1" },
          ],
        },
        [{ source: "action", key: "update-resource-suggestion" }],
      ),
    ).toBe(false);
  });

  it("finds a relevant review write anywhere in a coalesced action batch", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    const query = {
      queryKey: [
        "action",
        "list-review-comments",
        { resourceType: "document", resourceId: "document-1" },
      ],
    };
    expect(
      predicate(query, [
        { source: "action", key: "refresh-notion-sync-status" },
        { source: "action", key: "react-to-review-comment" },
      ]),
    ).toBe(true);
    expect(
      predicate(query, [
        { source: "action", key: "set-review-thread-muted" },
        { source: "action", key: "refresh-notion-sync-status" },
      ]),
    ).toBe(true);
  });

  it("refetches peer suggestion decisions and linked discussion state without a document change", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    let status = "pending";
    let rootStatus = "open";
    let replies = 0;
    let reactions = 0;
    const suggestionQuery = vi.fn(async () => ({
      suggestions: [{ id: "suggestion-1", status }],
    }));
    const reviewQuery = vi.fn(async () => ({
      comments: Array.from({ length: replies + 1 }, (_, index) => ({
        id: index === 0 ? "root" : `reply-${index}`,
        status: index === 0 ? rootStatus : "resolved",
      })),
      discussion: { reactions: { root: reactions } },
    }));
    const suggestionKey = [
      "action",
      "list-resource-suggestions",
      { resourceType: "document", resourceId: "document-1" },
    ] as const;
    const reviewKey = [
      "action",
      "list-review-comments",
      {
        resourceType: "document",
        resourceId: "document-1",
        targetId: "suggestion-1",
      },
    ] as const;
    const suggestionObserver = new QueryObserver(queryClient, {
      queryKey: suggestionKey,
      queryFn: suggestionQuery,
    });
    const reviewObserver = new QueryObserver(queryClient, {
      queryKey: reviewKey,
      queryFn: reviewQuery,
    });
    const unsubscribeSuggestion = suggestionObserver.subscribe(() => {});
    const unsubscribeReview = reviewObserver.subscribe(() => {});
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    try {
      await Promise.all([
        suggestionObserver.refetch(),
        reviewObserver.refetch(),
      ]);
      status = "rejected";
      rootStatus = "resolved";
      await queryClient.invalidateQueries({
        predicate: (query) =>
          predicate(query, [
            { source: "action", key: "decide-resource-suggestion" },
          ]),
      });
      expect(suggestionObserver.getCurrentResult().data).toMatchObject({
        suggestions: [{ status: "rejected" }],
      });
      expect(reviewObserver.getCurrentResult().data?.comments).toEqual([
        { id: "root", status: "resolved" },
      ]);

      replies = 1;
      await queryClient.invalidateQueries({
        predicate: (query) =>
          predicate(query, [{ source: "action", key: "reply-review-comment" }]),
      });
      expect(reviewObserver.getCurrentResult().data?.comments).toHaveLength(2);

      reactions = 1;
      await queryClient.invalidateQueries({
        predicate: (query) =>
          predicate(query, [
            { source: "action", key: "react-to-review-comment" },
          ]),
      });
      expect(
        reviewObserver.getCurrentResult().data?.discussion.reactions.root,
      ).toBe(1);
      expect(suggestionQuery).toHaveBeenCalledTimes(2);
      expect(reviewQuery).toHaveBeenCalledTimes(4);
    } finally {
      unsubscribeSuggestion();
      unsubscribeReview();
      queryClient.clear();
    }
  });

  it("refreshes the current document and comments after matching mutations", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");

    expect(
      predicate(
        {
          queryKey: ["action", "get-document", { id: "document-1" }],
        },
        [{ source: "action", key: "edit-document" }],
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: ["action", "list-comments", { documentId: "document-1" }],
        },
        [{ source: "action", key: "update-comment" }],
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: ["action", "get-document", { id: "document-1" }],
        },
        [{ source: "action", key: "update-comment" }],
      ),
    ).toBe(true);

    // The poll state keeps the newest key for each source. A later document
    // mutation can therefore be the only visible event after a comment write.
    expect(
      predicate(
        {
          queryKey: ["action", "list-comments", { documentId: "document-1" }],
        },
        [{ source: "action", key: "edit-document" }],
      ),
    ).toBe(true);
  });

  it("refreshes bounded database results after external row changes", () => {
    const predicate = contentActionInvalidatePredicate("/page/database-page");

    expect(
      predicate(
        {
          queryKey: [
            "action",
            "query-content-database-items",
            {
              documentId: "database-page",
              limit: 100,
              tableQuery: {
                search: "",
                filters: [],
                sorts: [],
                filterMode: "and",
              },
            },
          ],
        },
        [{ source: "action", key: "add-database-item" }],
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "query-content-database-items",
            { documentId: "database-page", limit: 100, tableQuery: {} },
          ],
        },
        [{ source: "action", key: "set-document-property" }],
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "query-content-database-items",
            { documentId: "other-database-page", tableQuery: {} },
          ],
        },
        [{ source: "action", key: "add-database-item" }],
      ),
    ).toBe(false);
  });

  it("refreshes an active inline database mounted on another host page", () => {
    const predicate = contentActionInvalidatePredicate("/page/host-document");
    const inlineDatabaseQuery = {
      queryKey: [
        "action",
        "query-content-database-items",
        {
          documentId: "inline-database-document",
          limit: 100,
          tableQuery: {
            search: "",
            filters: [],
            sorts: [],
            filterMode: "and",
          },
        },
      ],
      isActive: () => true,
    };

    expect(
      predicate(inlineDatabaseQuery, [
        { source: "action", key: "add-database-item" },
      ]),
    ).toBe(true);
    expect(
      predicate({ ...inlineDatabaseQuery, isActive: () => false }, [
        { source: "action", key: "add-database-item" },
      ]),
    ).toBe(false);
  });

  it("refreshes active saved-view and database lifecycle results", () => {
    const predicate = contentActionInvalidatePredicate("/page/host-document");
    const activeBaseQuery = {
      queryKey: [
        "action",
        "get-content-database",
        { documentId: "inline-database-document", limit: 100 },
      ],
      isActive: () => true,
    };
    const activeBoundedQuery = {
      queryKey: [
        "action",
        "query-content-database-items",
        {
          documentId: "inline-database-document",
          limit: 100,
          tableQuery: {
            search: "",
            filters: [],
            sorts: [],
            filterMode: "and",
          },
        },
      ],
      isActive: () => true,
    };

    expect(
      predicate(activeBaseQuery, [
        { source: "action", key: "update-content-database-view" },
      ]),
    ).toBe(true);
    expect(
      predicate(activeBoundedQuery, [
        { source: "action", key: "delete-content-database" },
      ]),
    ).toBe(true);
    expect(
      predicate(activeBaseQuery, [
        { source: "action", key: "restore-content-database" },
      ]),
    ).toBe(true);
  });

  it("refreshes only the active personal-view query for personal presentation writes", () => {
    const predicate = contentActionInvalidatePredicate("/page/database-page");
    const personalViewQuery = {
      queryKey: [
        "action",
        "get-content-database-personal-view",
        { databaseId: "database" },
      ],
      isActive: () => true,
    };

    expect(
      predicate(personalViewQuery, [
        { source: "action", key: "update-content-database-personal-view" },
      ]),
    ).toBe(true);
    expect(
      predicate({ ...personalViewQuery, isActive: () => false }, [
        {
          source: "action",
          key: "update-content-database-personal-view",
        },
      ]),
    ).toBe(false);
  });

  it("does not refresh unrelated documents or action queries", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");

    expect(
      predicate(
        {
          queryKey: ["action", "get-document", { id: "document-2" }],
        },
        [{ source: "action", key: "edit-document" }],
      ),
    ).toBe(false);
    expect(
      predicate(
        {
          queryKey: ["action", "list-comments", { documentId: "document-2" }],
        },
        [{ source: "action", key: "update-comment" }],
      ),
    ).toBe(false);
    expect(
      predicate({ queryKey: ["action", "refresh-notion-sync-status"] }, [
        { source: "action", key: "edit-document" },
      ]),
    ).toBe(false);
    expect(
      predicate({ queryKey: ["settings", "content"] }, [
        { source: "action", key: "edit-document" },
      ]),
    ).toBe(false);
  });

  it("does not refresh the open document for an unrelated mutation", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");

    expect(
      predicate(
        { queryKey: ["action", "get-document", { id: "document-1" }] },
        [{ source: "action", key: "refresh-notion-sync-status" }],
      ),
    ).toBe(false);
  });

  it("does not refresh document queries away from a document route", () => {
    expect(
      contentActionInvalidatePredicate("/settings")(
        { queryKey: ["action", "get-document", { id: "document-1" }] },
        [{ source: "action", key: "edit-document" }],
      ),
    ).toBe(false);
  });
});

describe("contentDocumentIdFromPathname", () => {
  it("reads only Content document routes", () => {
    expect(contentDocumentIdFromPathname("/page/document-1")).toBe(
      "document-1",
    );
    expect(contentDocumentIdFromPathname("/page/document%202/")).toBe(
      "document 2",
    );
    expect(contentDocumentIdFromPathname("/settings")).toBeUndefined();
  });
});
