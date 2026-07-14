import { describe, expect, it } from "vitest";

import {
  getOverviewScreenContentKey,
  hasSelectableCodeLayerParent,
  isDocumentShellCodeLayerNode,
  pendingEditTargetsSelectedElement,
  resolveEscapePopSelectionAction,
  shouldEscapeToOverview,
} from "./selection-state";

describe("getOverviewScreenContentKey", () => {
  it("keeps inline overview identity stable across active switch, content edits, and revision bumps", () => {
    const before = getOverviewScreenContentKey({
      screenId: "screen-a",
      screenIsActive: true,
      contentRenderRevision: 2,
      updatedAt: "before",
      content: "<main>before</main>",
      useRuntimeReplacement: true,
    });
    const after = getOverviewScreenContentKey({
      screenId: "screen-a",
      screenIsActive: false,
      contentRenderRevision: 99,
      updatedAt: "after",
      content: "<main>after</main>",
      useRuntimeReplacement: true,
    });

    expect(before).toBe("screen-a:inline-overview");
    expect(after).toBe(before);
  });

  it("retains the remount fallback for overview sources without runtime replacement", () => {
    const before = getOverviewScreenContentKey({
      screenId: "screen-a",
      screenIsActive: false,
      contentRenderRevision: 0,
      updatedAt: "before",
      content: "before",
      useRuntimeReplacement: false,
    });
    const after = getOverviewScreenContentKey({
      screenId: "screen-a",
      screenIsActive: false,
      contentRenderRevision: 0,
      updatedAt: "after",
      content: "after",
      useRuntimeReplacement: false,
    });
    expect(after).not.toBe(before);
  });
});

describe("resolveEscapePopSelectionAction", () => {
  it("pops to the parent layer when the selected layer has a code-layer parent", () => {
    expect(
      resolveEscapePopSelectionAction({
        hasSelectedLayer: true,
        hasLayerParent: true,
        viewMode: "single",
      }),
    ).toEqual({ kind: "pop-to-parent-layer" });

    expect(
      resolveEscapePopSelectionAction({
        hasSelectedLayer: true,
        hasLayerParent: true,
        viewMode: "overview",
      }),
    ).toEqual({ kind: "pop-to-parent-layer" });
  });

  it("pops a top-level (parentless) selected layer to its screen/frame in overview mode", () => {
    expect(
      resolveEscapePopSelectionAction({
        hasSelectedLayer: true,
        hasLayerParent: false,
        viewMode: "overview",
      }),
    ).toEqual({ kind: "pop-to-screen-frame" });
  });

  it("deselects a top-level selected layer in single-screen mode (no separate frame to pop to)", () => {
    expect(
      resolveEscapePopSelectionAction({
        hasSelectedLayer: true,
        hasLayerParent: false,
        viewMode: "single",
      }),
    ).toEqual({ kind: "deselect" });
  });

  it("deselects when nothing is selected, regardless of view mode", () => {
    expect(
      resolveEscapePopSelectionAction({
        hasSelectedLayer: false,
        hasLayerParent: false,
        viewMode: "single",
      }),
    ).toEqual({ kind: "deselect" });
    expect(
      resolveEscapePopSelectionAction({
        hasSelectedLayer: false,
        hasLayerParent: false,
        viewMode: "overview",
      }),
    ).toEqual({ kind: "deselect" });
  });
});

describe("isDocumentShellCodeLayerNode", () => {
  it("treats <body>/<html> nodes named purely from their tag as document shell nodes", () => {
    expect(
      isDocumentShellCodeLayerNode({ tag: "body", layerNameSource: "tag" }),
    ).toBe(true);
    expect(
      isDocumentShellCodeLayerNode({ tag: "html", layerNameSource: "tag" }),
    ).toBe(true);
  });

  it("does not treat a body/html node with a more specific layer name as a shell node", () => {
    // e.g. a <body data-agent-native-layer-name="Screen root"> — an explicit
    // rename means it should stay selectable like any other layer.
    expect(
      isDocumentShellCodeLayerNode({
        tag: "body",
        layerNameSource: "attribute",
      }),
    ).toBe(false);
  });

  it("does not treat non-shell tags as document shell nodes", () => {
    expect(
      isDocumentShellCodeLayerNode({ tag: "div", layerNameSource: "tag" }),
    ).toBe(false);
  });
});

describe("hasSelectableCodeLayerParent", () => {
  it("is false when there is no parent node at all", () => {
    expect(hasSelectableCodeLayerParent({ parentNode: undefined })).toBe(false);
    expect(hasSelectableCodeLayerParent({ parentNode: null })).toBe(false);
  });

  it("is false when the parent resolves to a collapsed document-shell node (BUG-ESCAPE-SHELL fail-before case)", () => {
    // Before the fix: a top-level layer's parentId still resolves to <body>
    // in the flat ownership map, and callers used a bare
    // Boolean(parentNode) check — which is true here — treating <body> as a
    // selectable parent layer. That is exactly the case that let Escape and
    // Shift+Enter walk into <body>/<html>.
    expect(
      hasSelectableCodeLayerParent({
        parentNode: { tag: "body", layerNameSource: "tag" },
      }),
    ).toBe(false);
    expect(
      hasSelectableCodeLayerParent({
        parentNode: { tag: "html", layerNameSource: "tag" },
      }),
    ).toBe(false);
  });

  it("is true for a real, non-shell parent layer", () => {
    expect(
      hasSelectableCodeLayerParent({
        parentNode: { tag: "div", layerNameSource: "semantic" },
      }),
    ).toBe(true);
  });
});

describe("pendingEditTargetsSelectedElement", () => {
  it("matches by sourceId when both edit and selection carry one", () => {
    expect(
      pendingEditTargetsSelectedElement({
        editSourceId: "node-1",
        editSelector: ".stale-selector",
        selectedSourceId: "node-1",
        selectedSelector: ".different-selector",
      }),
    ).toBe(true);
  });

  it("does not match a different sourceId even if selectors coincidentally match", () => {
    expect(
      pendingEditTargetsSelectedElement({
        editSourceId: "node-1",
        editSelector: ".same",
        selectedSourceId: "node-2",
        selectedSelector: ".same",
      }),
    ).toBe(false);
  });

  it("falls back to selector matching when the edit carries no sourceId", () => {
    expect(
      pendingEditTargetsSelectedElement({
        editSourceId: null,
        editSelector: ".card",
        selectedSourceId: undefined,
        selectedSelector: ".card",
      }),
    ).toBe(true);
  });

  it("does not match when neither sourceId nor selector line up", () => {
    expect(
      pendingEditTargetsSelectedElement({
        editSourceId: null,
        editSelector: ".card",
        selectedSourceId: "node-3",
        selectedSelector: ".other",
      }),
    ).toBe(false);
  });

  it("does not match against no current selection", () => {
    expect(
      pendingEditTargetsSelectedElement({
        editSourceId: "node-1",
        editSelector: ".card",
        selectedSourceId: null,
        selectedSelector: null,
      }),
    ).toBe(false);
  });
});

describe("shouldEscapeToOverview", () => {
  const base = {
    activeTool: "move" as const,
    drawMode: false,
    mode: "edit" as const,
    pinMode: false,
    selectedElement: null,
    viewMode: "single" as const,
  };

  it("is true only in single mode, edit mode, move tool, with nothing selected/drawing/pinning", () => {
    expect(shouldEscapeToOverview(base)).toBe(true);
  });

  it("is false in overview mode", () => {
    expect(shouldEscapeToOverview({ ...base, viewMode: "overview" })).toBe(
      false,
    );
  });

  it("is false when something is selected", () => {
    expect(
      shouldEscapeToOverview({
        ...base,
        selectedElement: {
          sourceId: "n1",
          selector: ".card",
        } as unknown as (typeof base)["selectedElement"],
      }),
    ).toBe(false);
  });

  it("is false while drawing or pinning", () => {
    expect(shouldEscapeToOverview({ ...base, drawMode: true })).toBe(false);
    expect(shouldEscapeToOverview({ ...base, pinMode: true })).toBe(false);
  });
});
