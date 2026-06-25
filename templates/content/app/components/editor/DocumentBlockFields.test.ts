import type { DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  blockFieldsFromProperties,
  blockFieldsRenderState,
  computeFieldReorderTarget,
  isLoadedForDocument,
} from "./DocumentBlockFields";

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

describe("computeFieldReorderTarget", () => {
  const fields = [
    property({
      id: "content",
      type: "blocks",
      position: 0,
      options: { blocks: { primary: true } },
    }),
    property({
      id: "summary",
      type: "blocks",
      position: 1,
      options: { blocks: { primary: false } },
    }),
    property({
      id: "notes",
      type: "blocks",
      position: 2,
      options: { blocks: { primary: false } },
    }),
  ];

  it("moves a field up by targeting the following field in the destination gap", () => {
    expect(computeFieldReorderTarget("notes", 1, fields)).toEqual({
      targetPropertyId: "summary",
      position: "before",
    });
  });

  it("moves a field down by targeting the following field in the destination gap", () => {
    expect(computeFieldReorderTarget("content", 2, fields)).toEqual({
      targetPropertyId: "notes",
      position: "before",
    });
  });

  it("moves a field to the very top", () => {
    expect(computeFieldReorderTarget("notes", 0, fields)).toEqual({
      targetPropertyId: "content",
      position: "before",
    });
  });

  it("moves a field to the very bottom using after the last field", () => {
    expect(computeFieldReorderTarget("content", 3, fields)).toEqual({
      targetPropertyId: "notes",
      position: "after",
    });
  });

  it("returns null for no-op drops into the field's own adjacent gaps", () => {
    expect(computeFieldReorderTarget("summary", 1, fields)).toBeNull();
    expect(computeFieldReorderTarget("summary", 2, fields)).toBeNull();
  });

  it("keeps non-Blocks fields out of the reorder target model", () => {
    const mixedFields = [
      fields[0]!,
      property({ id: "status", type: "status", position: 1 }),
      fields[1]!,
      fields[2]!,
    ];

    expect(computeFieldReorderTarget("notes", 1, mixedFields)).toEqual({
      targetPropertyId: "summary",
      position: "before",
    });
  });
});

describe("isLoadedForDocument (stale placeholder-data gate)", () => {
  it("is NOT loaded while no data has arrived", () => {
    expect(isLoadedForDocument("doc-new", undefined)).toBe(false);
  });

  it("is NOT loaded while data still belongs to the PREVIOUS document", () => {
    // useDocumentProperties keeps the old doc's data as placeholder for a tick
    // after documentId changes. Trusting it would route the new row's edits to
    // the old doc's field layout (body-clobber window). Must read as loading.
    expect(isLoadedForDocument("doc-new", { documentId: "doc-old" })).toBe(
      false,
    );
  });

  it("is loaded once the data's documentId matches the current row", () => {
    expect(isLoadedForDocument("doc-new", { documentId: "doc-new" })).toBe(
      true,
    );
  });

  it("stale previous-doc data renders 'loading', never a writable body editor", () => {
    // Compose the gate with the render-state machine the way the component does:
    // even though the (previous doc's) field list would be a solo PRIMARY field,
    // an identity mismatch forces `loaded:false` → loading, not a body editor.
    const previousDocPrimary = [
      property({
        id: "content",
        type: "blocks",
        position: 0,
        options: { blocks: { primary: true } },
      }),
    ];
    const loaded = isLoadedForDocument("doc-new", { documentId: "doc-old" });
    const state = blockFieldsRenderState({
      loaded,
      blockFields: previousDocPrimary,
    });
    expect(state.kind).toBe("loading");
  });

  it("a solo non-primary field for the NEW doc never routes to the body once identity matches", () => {
    const newDocSoloNonPrimary = [
      property({
        id: "outline",
        type: "blocks",
        position: 0,
        options: { blocks: { primary: false } },
      }),
    ];
    const loaded = isLoadedForDocument("doc-new", { documentId: "doc-new" });
    const state = blockFieldsRenderState({
      loaded,
      blockFields: newDocSoloNonPrimary,
    });
    expect(state).toMatchObject({ kind: "solo", target: "block_field_store" });
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
    const state = blockFieldsRenderState({
      loaded: true,
      blockFields: [field],
    });
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
    const state = blockFieldsRenderState({
      loaded: true,
      blockFields: [field],
    });
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
