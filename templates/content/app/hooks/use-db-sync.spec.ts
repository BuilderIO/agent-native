import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  contentActionInvalidatePredicate,
  contentDocumentIdFromPathname,
} from "./content-action-refresh";

describe("contentActionInvalidatePredicate", () => {
  it("refreshes the mounted document's save basis after a peer suggestion decision", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    let document = {
      content: "Original",
      revision: "body-1",
      collabContentRevision: null as string | null,
    };
    const queryFn = vi.fn(async () => document);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["action", "get-document", { id: "document-1" }],
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await observer.refetch();
      document = {
        content: "Accepted",
        revision: "body-2",
        collabContentRevision: "body-2",
      };
      await queryClient.invalidateQueries({
        predicate: (query) =>
          predicate(query, [
            { source: "action", key: "decide-resource-suggestion" },
          ]),
      });
      expect(observer.getCurrentResult().data).toEqual(document);
      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(
        predicate(
          {
            queryKey: ["action", "get-document", { id: "document-2" }],
            isActive: () => false,
          },
          [{ source: "action", key: "decide-resource-suggestion" }],
        ),
      ).toBe(false);
      for (const key of [
        "create-resource-suggestion",
        "update-resource-suggestion",
      ]) {
        expect(
          predicate(
            { queryKey: ["action", "get-document", { id: "document-1" }] },
            [{ source: "action", key }],
          ),
        ).toBe(false);
      }
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  it.each([
    "create-resource-suggestion",
    "suggest-document-edit",
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
    "suggest-document-edit",
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

    expect(
      predicate(
        {
          queryKey: ["action", "list-comments", { documentId: "document-1" }],
        },
        [{ source: "action", key: "edit-document" }],
      ),
    ).toBe(true);
  });

  it("refreshes mounted preview Page data without refreshing inactive cached rows", () => {
    const predicate = contentActionInvalidatePredicate("/page/collection");
    for (const name of [
      "get-document",
      "list-comments",
      "list-document-properties",
    ]) {
      const query = {
        queryKey: [
          "action",
          name,
          { id: "row", documentId: "row", databaseId: "db" },
        ],
        isActive: () => true,
      };
      expect(
        predicate(query, [{ source: "action", key: "update-document" }]),
      ).toBe(true);
      expect(
        predicate({ ...query, isActive: () => false }, [
          { source: "action", key: "update-document" },
        ]),
      ).toBe(false);
    }
    expect(
      predicate(
        {
          queryKey: ["action", "get-content-database", { id: "collection" }],
          isActive: () => true,
        },
        [{ source: "action", key: "update-document" }],
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

  it.each(["/page/database-page", "/home", "/trash"])(
    "refreshes document and Trash lists after external database lifecycle changes on %s",
    (pathname) => {
      const predicate = contentActionInvalidatePredicate(pathname);

      for (const queryName of [
        "list-content-databases",
        "list-documents",
        "list-trashed-content-databases",
        "list-trashed-documents",
      ]) {
        const query = { queryKey: ["action", queryName, {}] };
        expect(
          predicate(query, [
            { source: "action", key: "delete-content-database" },
          ]),
        ).toBe(true);
        expect(
          predicate(query, [
            { source: "action", key: "restore-content-database" },
          ]),
        ).toBe(true);
        expect(
          predicate(query, [{ source: "action", key: "update-document" }]),
        ).toBe(false);
      }
    },
  );

  it.each(["/home", "/settings", "/trash"])(
    "refreshes active sidebar database reads after lifecycle changes on %s",
    (pathname) => {
      const predicate = contentActionInvalidatePredicate(pathname);
      for (const queryName of [
        "get-content-database",
        "query-content-database-items",
      ]) {
        const query = {
          queryKey: ["action", queryName, { databaseId: "files" }],
          isActive: () => true,
        };
        for (const key of [
          "delete-content-database",
          "restore-content-database",
        ]) {
          expect(predicate(query, [{ source: "action", key }])).toBe(true);
          expect(
            predicate({ ...query, isActive: () => false }, [
              { source: "action", key },
            ]),
          ).toBe(false);
        }
        expect(
          predicate(query, [{ source: "action", key: "update-document" }]),
        ).toBe(false);
      }
    },
  );

  it.each(["/home", "/settings", "/trash", "/page/document-1"])(
    "reveals externally created pages in the document list on %s",
    (pathname) => {
      const predicate = contentActionInvalidatePredicate(pathname);
      const event = [{ source: "action", key: "create-document" }];

      expect(
        predicate({ queryKey: ["action", "list-documents", undefined] }, event),
      ).toBe(true);
      for (const queryName of [
        "get-content-database",
        "query-content-database-items",
      ]) {
        const filesQuery = {
          queryKey: ["action", queryName, { databaseId: "personal-files" }],
          isActive: () => true,
          meta: { contentDatabaseSystemRole: "files" },
        };
        expect(predicate(filesQuery, event)).toBe(true);
        expect(predicate({ ...filesQuery, isActive: () => false }, event)).toBe(
          false,
        );
      }
      expect(
        predicate(
          {
            queryKey: [
              "action",
              "query-content-database-items",
              { databaseId: "unrelated-collection" },
            ],
            isActive: () => true,
            meta: { contentDatabaseSystemRole: null },
          },
          event,
        ),
      ).toBe(false);
      expect(
        predicate(
          { queryKey: ["action", "list-trashed-documents", undefined] },
          event,
        ),
      ).toBe(false);
    },
  );

  it("preserves document invalidation in a coalesced creation batch", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    expect(
      predicate(
        {
          queryKey: ["action", "get-document", { id: "document-1" }],
          isActive: () => true,
        },
        [
          { source: "action", key: "create-document" },
          { source: "action", key: "edit-document" },
        ],
      ),
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

  it.each(["reply-to-comment-ai-request", "create-comment-ai-suggestion"])(
    "refreshes comments, request status, and proposals after %s",
    (eventKey) => {
      const predicate = contentActionInvalidatePredicate("/page/document-1");
      const queries = [
        ["action", "list-comments", { documentId: "document-1" }],
        ["action", "list-comment-ai-requests", { documentId: "document-1" }],
        [
          "action",
          "list-resource-suggestions",
          { resourceType: "document", resourceId: "document-1" },
        ],
      ] as const;

      for (const queryKey of queries) {
        expect(
          predicate({ queryKey }, [{ source: "action", key: eventKey }]),
        ).toBe(true);
      }
      expect(
        predicate(
          { queryKey: ["action", "get-document", { id: "document-1" }] },
          [{ source: "action", key: eventKey }],
        ),
      ).toBe(false);
    },
  );

  it("refreshes request status after starting a comment AI request", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    const event = [{ source: "action", key: "start-comment-ai-request" }];

    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-comment-ai-requests",
            { documentId: "document-1" },
          ],
        },
        event,
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: ["action", "list-comments", { documentId: "document-1" }],
        },
        event,
      ),
    ).toBe(false);
  });

  it("refreshes every changed comment AI surface after apply and resolve", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    const event = [{ source: "action", key: "apply-comment-ai-request" }];
    const queries = [
      ["action", "get-document", { id: "document-1" }],
      ["action", "list-comments", { documentId: "document-1" }],
      ["action", "list-comment-ai-requests", { documentId: "document-1" }],
      [
        "action",
        "list-resource-suggestions",
        { resourceType: "document", resourceId: "document-1" },
      ],
    ] as const;

    for (const queryKey of queries) {
      expect(predicate({ queryKey }, event)).toBe(true);
    }
  });

  it("refreshes only the document and proposals after a native suggestion decision", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    const event = [{ source: "action", key: "decide-resource-suggestion" }];

    expect(
      predicate(
        { queryKey: ["action", "get-document", { id: "document-1" }] },
        event,
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-resource-suggestions",
            { resourceType: "document", resourceId: "document-1" },
          ],
        },
        event,
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: ["action", "list-comments", { documentId: "document-1" }],
        },
        event,
      ),
    ).toBe(false);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-comment-ai-requests",
            { documentId: "document-1" },
          ],
        },
        event,
      ),
    ).toBe(false);
  });

  it("keeps comment AI refreshes scoped to the open document", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");
    const event = [{ source: "action", key: "reply-to-comment-ai-request" }];

    expect(
      predicate(
        {
          queryKey: [
            "action",
            "list-comment-ai-requests",
            { documentId: "document-2" },
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
            { resourceType: "database", resourceId: "document-1" },
          ],
        },
        event,
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

  it("refreshes active navigation and Recent after an external rename on any route", () => {
    const predicate = contentActionInvalidatePredicate("/settings");
    const event = [{ source: "action", key: "update-document" }];

    expect(
      predicate(
        {
          queryKey: [
            "action",
            "query-content-database-items",
            { databaseId: "files", navigation: { parentId: null } },
          ],
          isActive: () => true,
        },
        event,
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: ["action", "get-content-recent", { scopeKey: "user" }],
          isActive: () => true,
        },
        event,
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: [
            "action",
            "get-content-navigation-context",
            { id: "document" },
          ],
          isActive: () => true,
        },
        event,
      ),
    ).toBe(true);
    expect(
      predicate(
        {
          queryKey: ["action", "get-content-recent", { scopeKey: "user" }],
          isActive: () => false,
        },
        event,
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
