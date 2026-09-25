import { describe, expect, it } from "vitest";

import { resolveNewDeckReferenceSelection } from "./new-deck-reference-selection";

describe("resolveNewDeckReferenceSelection", () => {
  it("uses defaults while the picker is still auto-managed", () => {
    expect(
      resolveNewDeckReferenceSelection({
        designSystemAuto: true,
        selectedDesignSystemId: null,
        defaultDesignSystemId: "ds-default",
        referenceDeckAuto: true,
        selectedReferenceDeckId: null,
        defaultReferenceDeckId: "deck-default",
      }),
    ).toEqual({
      designSystemId: "ds-default",
      referenceDeckId: "deck-default",
    });
  });

  it("lets explicit removals override the defaults", () => {
    expect(
      resolveNewDeckReferenceSelection({
        designSystemAuto: false,
        selectedDesignSystemId: null,
        defaultDesignSystemId: "ds-default",
        referenceDeckAuto: false,
        selectedReferenceDeckId: null,
        defaultReferenceDeckId: "deck-default",
      }),
    ).toEqual({
      designSystemId: null,
      referenceDeckId: null,
    });
  });

  it("keeps explicit picks even when defaults are present", () => {
    expect(
      resolveNewDeckReferenceSelection({
        designSystemAuto: false,
        selectedDesignSystemId: "ds-picked",
        defaultDesignSystemId: "ds-default",
        referenceDeckAuto: false,
        selectedReferenceDeckId: "deck-picked",
        defaultReferenceDeckId: "deck-default",
      }),
    ).toEqual({
      designSystemId: "ds-picked",
      referenceDeckId: "deck-picked",
    });
  });
});
