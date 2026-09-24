import { describe, expect, it } from "vitest";

import {
  selectReadableBlocksField,
  wordCountResult,
} from "./get-blocks-field-word-count";

function field(args: {
  id: string;
  primary?: boolean;
  type?: string;
  visibility?: string;
  value?: unknown;
}) {
  return {
    definition: {
      id: args.id,
      name: args.id,
      type: args.type ?? "blocks",
      visibility: args.visibility ?? "always_show",
      options: { blocks: { primary: args.primary === true } },
    },
    value: args.value ?? "words",
  } as any;
}

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

  it("does not invent a primary field for a database Page without one", () => {
    expect(() =>
      selectReadableBlocksField(
        { properties: [field({ id: "notes" })], hasDatabase: true },
        undefined,
      ),
    ).toThrow(/no visible primary Content field/i);
  });

  it("rejects hidden, scalar, primary, and mismatched additional fields", () => {
    const properties = [
      field({ id: "primary", primary: true }),
      field({ id: "hidden", visibility: "always_hide" }),
      field({ id: "empty", visibility: "hide_when_empty", value: "" }),
      field({ id: "scalar", type: "text" }),
    ];
    for (const propertyId of [
      "primary",
      "hidden",
      "empty",
      "scalar",
      "missing",
    ]) {
      expect(() =>
        selectReadableBlocksField(
          { properties, hasDatabase: true },
          propertyId,
        ),
      ).toThrow(/not found for this Page/i);
    }
  });

  it("can structurally select an empty hide-when-empty field before flushing", () => {
    const property = field({
      id: "notes",
      visibility: "hide_when_empty",
      value: "",
    });
    expect(
      selectReadableBlocksField(
        { properties: [property], hasDatabase: true },
        "notes",
        { requireValueVisibility: false },
      ),
    ).toMatchObject({ property, primary: false });
    expect(() =>
      selectReadableBlocksField(
        { properties: [property], hasDatabase: true },
        "notes",
      ),
    ).toThrow(/not found for this Page/i);
  });

  it("can retain an exact empty field identity after flushing", () => {
    const property = field({
      id: "notes",
      visibility: "hide_when_empty",
      value: "",
    });
    expect(
      selectReadableBlocksField(
        { properties: [property], hasDatabase: true },
        "notes",
        { requireValueVisibility: false },
      ),
    ).toEqual({ property, primary: false });
  });

  it("keeps the implicit primary field only for standalone Pages", () => {
    expect(
      selectReadableBlocksField(
        { properties: [], hasDatabase: false },
        undefined,
      ),
    ).toBeNull();
  });
});
