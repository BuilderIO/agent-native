import { describe, expect, it } from "vitest";

import {
  getDraggedLayerIdsForRows,
  getLayerSelectionAnchorFromExternalSelection,
  getTreeOrderedLayerIds,
  shouldResyncLayerSelectionAnchor,
  type FlatLayerRow,
} from "./LayersPanel";

function row(
  id: string,
  ancestorIds: string[] = [],
  selectable = true,
): FlatLayerRow {
  return {
    node: { id, name: id, selectable },
    rowKey: id,
    depth: ancestorIds.length,
    ancestorIds,
    hasChildren: false,
    canAcceptChildren: false,
  };
}

describe("LayersPanel selection anchors", () => {
  it("uses the latest externally selected visible layer as the shift anchor", () => {
    expect(
      getLayerSelectionAnchorFromExternalSelection({
        selectedIds: ["panel-old", "__header", "canvas-current"],
        selectableVisibleIds: ["panel-old", "canvas-current"],
      }),
    ).toBe("canvas-current");
  });

  it("clears the range anchor when external selection is no longer visible", () => {
    expect(
      getLayerSelectionAnchorFromExternalSelection({
        selectedIds: ["hidden-layer"],
        selectableVisibleIds: ["visible-layer"],
      }),
    ).toBeNull();
  });

  it("resyncs when filtering hides the existing range anchor", () => {
    expect(
      shouldResyncLayerSelectionAnchor({
        selectionSignature: "same-selection",
        lastPanelSelectionSignature: "same-selection",
        currentAnchor: "filtered-out",
        selectableVisibleIds: ["still-visible"],
      }),
    ).toBe(true);
  });
});

describe("LayersPanel drag payload ordering", () => {
  const rows = [
    row("__code_section__", [], false),
    row("parent"),
    row("first", ["parent"]),
    row("second", ["parent"]),
    row("third", ["parent"]),
  ];

  it("normalizes multi-drag payloads to visible tree order", () => {
    expect(getTreeOrderedLayerIds(["third", "first"], rows)).toEqual([
      "first",
      "third",
    ]);
  });

  it("drops selected descendants when their ancestor is dragged", () => {
    expect(
      getDraggedLayerIdsForRows({
        selectedIds: ["third", "parent", "first"],
        nodeId: "parent",
        visibleRows: rows,
      }),
    ).toEqual(["parent"]);
  });
});
