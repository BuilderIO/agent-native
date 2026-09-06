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
