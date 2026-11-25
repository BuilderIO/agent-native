// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

import {
  blockFieldsFromProperties,
  blockFieldsRenderState,
  computeFieldReorderTarget,
  DocumentBlockFields,
  isLoadedForDocument,
  primaryBlocksFieldAvailable,
} from "./DocumentBlockFields";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

// The property read is the one stand-in; whether it failed is still decided
// by the real hook module.
const propertyRead = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useDocumentProperties: () => propertyRead.current,
}));

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
    expect(isLoadedForDocument("doc-new", "db-new", undefined)).toBe(false);
  });

  it("is NOT loaded while data still belongs to the PREVIOUS document", () => {
    expect(
      isLoadedForDocument("doc-new", "db-new", {
        documentId: "doc-old",
        databaseId: "db-new",
        properties: [],
      }),
    ).toBe(false);
  });

  it("is NOT loaded while data still belongs to the previous database", () => {
    expect(
      isLoadedForDocument("doc-new", "db-new", {
        documentId: "doc-new",
        databaseId: "db-old",
        properties: [],
      }),
    ).toBe(false);
  });

  it("is loaded once both response identities match the active scope", () => {
    expect(
      isLoadedForDocument("doc-new", "db-new", {
        documentId: "doc-new",
        databaseId: "db-new",
        properties: [],
      }),
    ).toBe(true);
  });

  it("stale previous-doc data renders 'loading', never a writable body editor", () => {
    const previousDocPrimary = [
      property({
        id: "content",
        type: "blocks",
        position: 0,
        options: { blocks: { primary: true } },
      }),
    ];
    const loaded = isLoadedForDocument("doc-new", "db-new", {
      documentId: "doc-old",
      databaseId: "db-new",
      properties: [],
    });
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
    const loaded = isLoadedForDocument("doc-new", "db-new", {
      documentId: "doc-new",
      databaseId: "db-new",
      properties: [],
    });
    const state = blockFieldsRenderState({
      loaded,
      blockFields: newDocSoloNonPrimary,
    });
    expect(state).toMatchObject({ kind: "solo", target: "block_field_store" });
  });
});

describe("blockFieldsRenderState", () => {
  it("is 'loading' before field data arrives — never a writable body editor", () => {
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
    expect(state.kind).toBe("loading");
  });

  it("is 'empty' when loaded with zero Blocks fields — no body editor", () => {
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

describe("primaryBlocksFieldAvailable", () => {
  const primary = property({
    id: "content",
    type: "blocks",
    options: { blocks: { primary: true } },
  });
  const secondary = property({
    id: "outline",
    type: "blocks",
    options: { blocks: { primary: false } },
  });

  it("requires a loaded primary Blocks field", () => {
    expect(primaryBlocksFieldAvailable({ kind: "loading" })).toBe(false);
    expect(primaryBlocksFieldAvailable({ kind: "empty" })).toBe(false);
    expect(
      primaryBlocksFieldAvailable({
        kind: "solo",
        field: secondary,
        target: "block_field_store",
      }),
    ).toBe(false);
    expect(
      primaryBlocksFieldAvailable({
        kind: "solo",
        field: primary,
        target: "document_body",
      }),
    ).toBe(true);
    expect(
      primaryBlocksFieldAvailable({ kind: "multi", fields: [secondary] }),
    ).toBe(false);
    expect(
      primaryBlocksFieldAvailable({
        kind: "multi",
        fields: [secondary, primary],
      }),
    ).toBe(true);
  });
});

describe("property-query failure UI", () => {
  // oracle-change: the DocumentBlockFields.tsx source grep became this rendered failed read
  it("offers a retry instead of loading or an editor when the property read fails", async () => {
    const refetch = vi.fn();
    propertyRead.current = {
      data: undefined,
      dataUpdatedAt: 0,
      fetchStatus: "idle",
      isError: true,
      isPlaceholderData: false,
      refetch,
    };
    const { container } = renderUi(
      createElement(DocumentBlockFields, {
        documentId: "doc-1",
        databaseId: "db-1",
        databaseDocumentId: "db-page",
        canEdit: true,
        primaryEditor: createElement("div", { "data-primary-editor": "" }),
      }),
    );

    const state = container.querySelector("[data-block-fields-state]");
    expect(state?.getAttribute("data-block-fields-state")).toBe("error");
    expect(container.querySelector("[data-primary-editor]")).toBeNull();
    // Its column can still shrink below its widest line.
    expect(state?.classList.contains("grid-cols-[minmax(0,1fr)]")).toBe(true);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "database.retry",
    );
    if (!retry) throw new Error("The failed read offers no Retry.");
    await click(retry);
    expect(refetch).toHaveBeenCalledOnce();
  });
});
