import type { CodeLayerNode } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import type { GeometryHistorySelection } from "./history";
import {
  getOverviewScreenExportGeometryById,
  elementInfoForSelectionSnapshot,
  getOverviewScreenContentKey,
  hasSelectableCodeLayerParent,
  isDocumentShellCodeLayerNode,
  isUserOriginatedSelectionIntent,
  overviewSelectionTargetsElement,
  pendingEditTargetsSelectedElement,
  resolveMarqueeAdditive,
  resolveOverviewScreenFrameGeometry,
  resolveEffectiveSelectedLayerIds,
  selectionHistorySnapshotsEqual,
  shouldClearSelectionForReviewThreadTarget,
  shouldEscapeToOverview,
} from "./selection-state";

describe("overview screen export geometry", () => {
  it("uses the live natural height only for explicit Hug screens", () => {
    const persisted = {
      hug: { x: 20, y: 40, width: 300, height: 400 },
      fixed: { x: 360, y: 40, width: 300, height: 400 },
    };
    const result = getOverviewScreenExportGeometryById({
      overviewScreens: [
        { id: "hug", width: 300, height: 400, heightMode: "hug" },
        { id: "fixed", width: 300, height: 400, heightMode: "fixed" },
      ],
      canvasFrameGeometryById: persisted,
      naturalHeightsById: { hug: 84, fixed: 96 },
    });

    expect(result.hug).toEqual({ ...persisted.hug, height: 84 });
    expect(result.fixed).toEqual(persisted.fixed);
    expect(persisted.hug.height).toBe(400);
    expect(persisted.fixed.height).toBe(400);
  });

  it("keeps persisted height until Hug content has a valid measurement", () => {
    expect(
      resolveOverviewScreenFrameGeometry({
        screen: { id: "hug", width: 300, height: 400, heightMode: "hug" },
        screenIndex: 0,
        canvasFrameGeometryById: { hug: { width: 300, height: 400 } },
        naturalHeight: Number.NaN,
      }).height,
    ).toBe(400);
  });
});

function makeSelection(
  overrides: Partial<GeometryHistorySelection> = {},
): GeometryHistorySelection {
  return {
    overviewSelectedScreenIds: [],
    selectedLayerIds: [],
    activeFileId: null,
    ...overrides,
  };
}

function makeNode(overrides: Partial<CodeLayerNode> = {}): CodeLayerNode {
  const selector = overrides.selector ?? "div";
  return {
    id: overrides.id ?? "node-1",
    tag: overrides.tag ?? "div",
    layerName: overrides.layerName ?? "Div",
    layerNameSource: overrides.layerNameSource ?? "tag",
    paintsOwnText: overrides.paintsOwnText ?? false,
    repeatXFor: overrides.repeatXFor ?? null,
    selector,
    selectors: overrides.selectors ?? [selector],
    path: overrides.path ?? selector,
    attributes: overrides.attributes ?? {},
    dataAttributes: overrides.dataAttributes ?? {},
    classes: overrides.classes ?? [],
    textSnippet: overrides.textSnippet ?? null,
    style: overrides.style ?? {},
    styleTokens: overrides.styleTokens ?? [],
    parentId: overrides.parentId,
    children: overrides.children ?? [],
    layout: overrides.layout ?? {
      siblingIndex: 0,
      nthOfType: 1,
      isFlexContainer: false,
      isGridContainer: false,
    },
    capabilities: overrides.capabilities ?? [],
    confidence: overrides.confidence ?? 1,
    source: overrides.source ?? null,
    componentInstance: overrides.componentInstance,
  };
}

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

describe("shouldClearSelectionForReviewThreadTarget", () => {
  it("clears stale layer context when thread focus changes screens", () => {
    expect(
      shouldClearSelectionForReviewThreadTarget({
        activeFileId: "screen-a",
        targetId: "screen-b",
      }),
    ).toBe(true);
  });

  it("preserves selection for same-screen and design-wide threads", () => {
    expect(
      shouldClearSelectionForReviewThreadTarget({
        activeFileId: "screen-a",
        targetId: "screen-a",
      }),
    ).toBe(false);
    expect(
      shouldClearSelectionForReviewThreadTarget({
        activeFileId: "screen-a",
        targetId: null,
      }),
    ).toBe(false);
  });

  it("clears screen selection when a board thread becomes the focus", () => {
    expect(
      shouldClearSelectionForReviewThreadTarget({
        activeFileId: "screen-a",
        targetId: null,
        boardFileId: "board",
      }),
    ).toBe(true);
    expect(
      shouldClearSelectionForReviewThreadTarget({
        activeFileId: "board",
        targetId: null,
        boardFileId: "board",
      }),
    ).toBe(false);
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

describe("overviewSelectionTargetsElement", () => {
  const element = {
    tagName: "DIV",
    selector: ".card",
  } as unknown as Parameters<
    typeof overviewSelectionTargetsElement
  >[0]["selectedElement"];

  it("routes an arrow key to the element rather than sliding the screen frame", () => {
    expect(
      overviewSelectionTargetsElement({
        selectedElement: element,
        selectedLayerIds: ["html:card-one"],
        fileIds: ["screen-1"],
      }),
    ).toBe(true);
  });

  it("routes Delete to the element when a layer inside a screen is selected", () => {
    expect(
      overviewSelectionTargetsElement({
        selectedElement: null,
        selectedLayerIds: ["html:card-one"],
        fileIds: ["screen-1", "screen-2"],
      }),
    ).toBe(true);
  });

  it("routes Delete to the element for a canvas element selection", () => {
    expect(
      overviewSelectionTargetsElement({
        selectedElement: element,
        selectedLayerIds: [],
        fileIds: ["screen-1"],
      }),
    ).toBe(true);
  });

  it("leaves a screen-frame selection to the screen-delete confirmation", () => {
    expect(
      overviewSelectionTargetsElement({
        selectedElement: null,
        selectedLayerIds: ["screen-1", "__pseudo-row"],
        fileIds: ["screen-1", "screen-2"],
      }),
    ).toBe(false);
  });

  it("treats the screen root element as the screen, not an element", () => {
    expect(
      overviewSelectionTargetsElement({
        selectedElement: {
          tagName: "BODY",
        } as unknown as typeof element,
        selectedLayerIds: ["screen-1"],
        fileIds: ["screen-1"],
      }),
    ).toBe(false);
  });
});

describe("isUserOriginatedSelectionIntent", () => {
  it("is false for a gesture/echo reselect with no intent (duplicate clone, catch-up echo, reparent commit)", () => {
    expect(isUserOriginatedSelectionIntent(undefined)).toBe(false);
  });

  it("is true for a real pointer click", () => {
    expect(
      isUserOriginatedSelectionIntent({ source: "pointer", additive: false }),
    ).toBe(true);
  });

  it("is true for a keyboard or marquee pick", () => {
    expect(isUserOriginatedSelectionIntent({ source: "keyboard" })).toBe(true);
    expect(isUserOriginatedSelectionIntent({ source: "marquee" })).toBe(true);
  });
});

describe("resolveMarqueeAdditive", () => {
  it("preserves Shift additive semantics for pointer picks", () => {
    expect(resolveMarqueeAdditive({ shiftKey: true, source: "pointer" })).toBe(
      true,
    );
  });
});

describe("selectionHistorySnapshotsEqual", () => {
  it("treats two snapshots with the same fields as equal", () => {
    expect(
      selectionHistorySnapshotsEqual(
        makeSelection({ selectedLayerIds: ["a"], activeFileId: "screen-1" }),
        makeSelection({ selectedLayerIds: ["a"], activeFileId: "screen-1" }),
      ),
    ).toBe(true);
  });

  it("is false when the selected layer ids differ (click A, click B)", () => {
    expect(
      selectionHistorySnapshotsEqual(
        makeSelection({ selectedLayerIds: ["a"] }),
        makeSelection({ selectedLayerIds: ["b"] }),
      ),
    ).toBe(false);
  });

  it("is false when one side deselected to nothing", () => {
    expect(
      selectionHistorySnapshotsEqual(
        makeSelection({ selectedLayerIds: ["a"] }),
        makeSelection({ selectedLayerIds: [] }),
      ),
    ).toBe(false);
  });

  it("is false when only the active file differs", () => {
    expect(
      selectionHistorySnapshotsEqual(
        makeSelection({ activeFileId: "screen-1" }),
        makeSelection({ activeFileId: "screen-2" }),
      ),
    ).toBe(false);
  });

  it("is false when only the overview screen selection differs", () => {
    expect(
      selectionHistorySnapshotsEqual(
        makeSelection({ overviewSelectedScreenIds: ["screen-1"] }),
        makeSelection({ overviewSelectedScreenIds: ["screen-2"] }),
      ),
    ).toBe(false);
  });
});

describe("elementInfoForSelectionSnapshot", () => {
  it("derives the canvas selection overlay's element from a single restored layer id", () => {
    const node = makeNode({ id: "box-a", tag: "div" });
    const owners = new Map([["box-a", { node }]]);

    const info = elementInfoForSelectionSnapshot(
      makeSelection({ selectedLayerIds: ["box-a"] }),
      owners,
    );

    expect(info?.tagName).toBe("div");
  });

  it("returns null for a multi-layer selection (no single overlay to restore)", () => {
    const owners = new Map([
      ["box-a", { node: makeNode({ id: "box-a" }) }],
      ["box-b", { node: makeNode({ id: "box-b" }) }],
    ]);

    expect(
      elementInfoForSelectionSnapshot(
        makeSelection({ selectedLayerIds: ["box-a", "box-b"] }),
        owners,
      ),
    ).toBeNull();
  });

  it("returns null for an empty selection (deselected)", () => {
    expect(
      elementInfoForSelectionSnapshot(makeSelection(), new Map()),
    ).toBeNull();
  });

  it("returns null when the layer id has no owner (e.g. a selected screen id)", () => {
    expect(
      elementInfoForSelectionSnapshot(
        makeSelection({ selectedLayerIds: ["screen-1"] }),
        new Map(),
      ),
    ).toBeNull();
  });
});

describe("resolveEffectiveSelectedLayerIds", () => {
  it("does not resurrect a member a Shift+click toggle-off just removed, once the primary follows the remaining member", () => {
    expect(resolveEffectiveSelectedLayerIds(["node-b"], "node-b")).toEqual([
      "node-b",
    ]);
  });

  it("re-adds the primary when a stale re-anchoring echo dropped it from an otherwise multi-item selection", () => {
    expect(
      resolveEffectiveSelectedLayerIds(["node-a", "node-b"], "node-c"),
    ).toEqual(["node-a", "node-b", "node-c"]);
  });

  it("replaces a single-item (or empty) filtered selection with just the primary when it fell out", () => {
    expect(resolveEffectiveSelectedLayerIds(["node-a"], "node-b")).toEqual([
      "node-b",
    ]);
    expect(resolveEffectiveSelectedLayerIds([], "node-b")).toEqual(["node-b"]);
  });

  it("passes the filtered selection through unchanged when there is no primary", () => {
    expect(resolveEffectiveSelectedLayerIds(["node-a"], null)).toEqual([
      "node-a",
    ]);
  });
});
