import { describe, expect, it } from "vitest";

import {
  contentActionInvalidatePredicate,
  contentDocumentIdFromPathname,
} from "./content-action-refresh";

describe("contentActionInvalidatePredicate", () => {
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
