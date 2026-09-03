import { describe, expect, it } from "vitest";

import {
  contentActionInvalidatePredicate,
  contentDocumentIdFromPathname,
} from "./content-action-refresh";

describe("contentActionInvalidatePredicate", () => {
  it("refreshes the current document and comments after any external mutation", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");

    expect(
      predicate({
        queryKey: ["action", "get-document", { id: "document-1" }],
      }),
    ).toBe(true);
    expect(
      predicate({
        queryKey: ["action", "list-comments", { documentId: "document-1" }],
      }),
    ).toBe(true);
  });

  it("does not refresh unrelated documents or action queries", () => {
    const predicate = contentActionInvalidatePredicate("/page/document-1");

    expect(
      predicate({
        queryKey: ["action", "get-document", { id: "document-2" }],
      }),
    ).toBe(false);
    expect(
      predicate({
        queryKey: ["action", "list-comments", { documentId: "document-2" }],
      }),
    ).toBe(false);
    expect(
      predicate({ queryKey: ["action", "refresh-notion-sync-status"] }),
    ).toBe(false);
    expect(predicate({ queryKey: ["settings", "content"] })).toBe(false);
  });

  it("does not refresh document queries away from a document route", () => {
    expect(
      contentActionInvalidatePredicate("/settings")({
        queryKey: ["action", "get-document", { id: "document-1" }],
      }),
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
