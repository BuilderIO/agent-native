import { describe, expect, it } from "vitest";
import {
  blockFieldsFromProperties,
  blockFieldsRenderState,
} from "./DocumentBlockFields";
import type { DocumentProperty } from "@shared/api";

function property(
  partial: Partial<DocumentProperty["definition"]> & {
    id: string;
    type: DocumentProperty["definition"]["type"];
  },
): DocumentProperty {
  return {
    definition: {
      databaseId: "db-1",
      name: partial.name ?? partial.id,
      visibility: "always_show",
      options: partial.options ?? {},
      position: partial.position ?? 0,
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
      ...partial,
    },
    value: "",
    editable: true,
  };
}

describe("blockFieldsFromProperties", () => {
  it("keeps only Blocks fields, sorted by position", () => {
    const properties = [
      property({ id: "title", type: "text", position: 0 }),
      property({
        id: "outline",
        type: "blocks",
        position: 2,
        options: { blocks: { primary: false } },
      }),
      property({ id: "status", type: "status", position: 1 }),
      property({
        id: "content",
        type: "blocks",
        position: 1,
        options: { blocks: { primary: true } },
      }),
    ];

    const blockFields = blockFieldsFromProperties(properties);
    expect(blockFields.map((field) => field.definition.id)).toEqual([
      "content",
      "outline",
    ]);
  });

  it("returns an empty list when there are no Blocks fields", () => {
    const properties = [
      property({ id: "title", type: "text", position: 0 }),
      property({ id: "status", type: "status", position: 1 }),
    ];
    expect(blockFieldsFromProperties(properties)).toEqual([]);
  });
});

describe("blockFieldsRenderState", () => {
  it("is 'loading' before field data arrives — never a writable body editor", () => {
    // The list is `[]` only because nothing has loaded. We must NOT treat this
    // as a solo primary field and route to the body, since a surviving
    // non-primary field would then clobber `documents.content` during load.
    const state = blockFieldsRenderState({ loaded: false, blockFields: [] });
    expect(state.kind).toBe("loading");
  });

  it("stays 'loading' even if a stale/empty list is passed while not loaded", () => {
    const state = blockFieldsRenderState({
      loaded: false,
      blockFields: [
        property({
          id: "content",
          type: "blocks",
          position: 0,
          options: { blocks: { primary: true } },
        }),
      ],
    });
    // Identity is not trusted until the query confirms it is loaded.
    expect(state.kind).toBe("loading");
  });

  it("is 'empty' when loaded with zero Blocks fields — no body editor", () => {
    // Deleting the only Blocks field leaves a metadata-only row. This must NOT
    // fall back to the body editor.
    const state = blockFieldsRenderState({ loaded: true, blockFields: [] });
    expect(state.kind).toBe("empty");
  });

  it("routes a solo PRIMARY field to the document body (Yjs editor)", () => {
    const field = property({
      id: "content",
      type: "blocks",
      position: 0,
      options: { blocks: { primary: true } },
    });
    const state = blockFieldsRenderState({ loaded: true, blockFields: [field] });
    expect(state).toMatchObject({ kind: "solo", target: "document_body" });
  });

  it("routes a solo NON-PRIMARY field to the block-field store, not the body — even right after load", () => {
    // The primary "Content" field was deleted; a non-primary field is now the
    // sole field and renders chromeless. It must read AND write its OWN store
    // the instant data loads, not the body.
    const field = property({
      id: "outline",
      type: "blocks",
      position: 0,
      options: { blocks: { primary: false } },
    });
    const state = blockFieldsRenderState({ loaded: true, blockFields: [field] });
    expect(state).toMatchObject({
      kind: "solo",
      target: "block_field_store",
    });
    if (state.kind === "solo") {
      expect(state.field.definition.id).toBe("outline");
    }
  });

  it("is 'multi' when loaded with two or more fields", () => {
    const fields = [
      property({
        id: "content",
        type: "blocks",
        position: 0,
        options: { blocks: { primary: true } },
      }),
      property({
        id: "outline",
        type: "blocks",
        position: 1,
        options: { blocks: { primary: false } },
      }),
    ];
    const state = blockFieldsRenderState({ loaded: true, blockFields: fields });
    expect(state.kind).toBe("multi");
  });
});
