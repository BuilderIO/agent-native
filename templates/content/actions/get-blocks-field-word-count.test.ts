import { describe, expect, it } from "vitest";

import { wordCountResult } from "./get-blocks-field-word-count";

describe("get-blocks-field-word-count", () => {
  it("returns the selected field identity with its word count", () => {
    expect(
      wordCountResult({
        documentId: "document-1",
        propertyId: "property-notes",
        name: "Notes",
        primary: false,
        content: "One two\nthree",
      }),
    ).toEqual({
      documentId: "document-1",
      propertyId: "property-notes",
      name: "Notes",
      primary: false,
      wordCount: 3,
    });
  });

  it("keeps the primary Content field distinct from additional fields", () => {
    expect(
      wordCountResult({
        documentId: "document-1",
        propertyId: null,
        name: "Content",
        primary: true,
        content: "",
      }),
    ).toMatchObject({ propertyId: null, primary: true, wordCount: 0 });
  });
});
