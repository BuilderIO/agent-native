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
