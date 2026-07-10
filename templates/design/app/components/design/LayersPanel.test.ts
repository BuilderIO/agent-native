import type { DragEvent } from "react";
import { describe, expect, it } from "vitest";

import {
  buildAncestorIdMap,
  buildLayerNodeMap,
  collectDescendantContainerIds,
  computeLayerMultiSelectIds,
  dropDescendantsOfSelectedAncestors,
  dropPlacementForEvent,
  findNodeWithAncestors,
  flattenRows,
  getContextMenuTargetIds,
  getDraggedLayerIdsForRows,
  getLayerSelectionAnchorFromExternalSelection,
  getTreeOrderedLayerIds,
  mapPanelMoveIntentToDomIntent,
  mapPanelPlacementToDomPlacement,
  nextAutoExpandedIds,
  nextExpandedIdsForSubtree,
  shouldResyncLayerSelectionAnchor,
  shapeLayerUsesLayoutGlyph,
  type FlatLayerRow,
  type LayersPanelNode,
} from "./LayersPanel";

describe("LayersPanel promoted rectangle glyphs", () => {
  it("uses the auto-layout glyph after a rectangle becomes a flex container", () => {
    expect(
      shapeLayerUsesLayoutGlyph({
        type: "rectangle",
        layout: { isFlexContainer: true, flexDirection: "row" },
      }),
    ).toBe(true);
    expect(
      shapeLayerUsesLayoutGlyph({
        type: "shape",
        layout: { isGridContainer: true },
      }),
    ).toBe(true);
  });

  it("keeps an ordinary rectangle on the rectangle glyph", () => {
    expect(
      shapeLayerUsesLayoutGlyph({
        type: "rectangle",
        layout: { isFlexContainer: false, isGridContainer: false },
      }),
    ).toBe(false);
  });
});

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

  it("L13: drops a selected descendant nested inside a COLLAPSED dragged parent using the full-tree ancestor map, even though visibleRows doesn't include it", () => {
    // "hidden-child" is a descendant of "collapsed-parent" but is NOT in
    // visibleRows (its ancestor is collapsed, so it was never flattened).
    // Without the L13 fix, getDraggedLayerIdsForRows would fail to find its
    // row in visibleRows and treat it as a separate top-level drag target,
    // extracting it from the parent being dragged.
    const rowsWithCollapsedParent = [row("collapsed-parent"), row("sibling")];
    const tree: LayersPanelNode[] = [
      {
        id: "collapsed-parent",
        name: "collapsed-parent",
        children: [{ id: "hidden-child", name: "hidden-child" }],
      },
      { id: "sibling", name: "sibling" },
    ];
    const ancestorIdMap = buildAncestorIdMap(tree);

    expect(
      getDraggedLayerIdsForRows({
        selectedIds: ["hidden-child", "collapsed-parent"],
        nodeId: "collapsed-parent",
        visibleRows: rowsWithCollapsedParent,
        ancestorIdMap,
      }),
    ).toEqual(["collapsed-parent"]);
  });

  it("L13: buildAncestorIdMap reports the full ancestor chain for a deeply nested node", () => {
    const tree: LayersPanelNode[] = [
      {
        id: "a",
        name: "a",
        children: [
          {
            id: "b",
            name: "b",
            children: [{ id: "c", name: "c", children: [] }],
          },
        ],
      },
    ];
    const map = buildAncestorIdMap(tree);
    expect(map.get("c")).toEqual(["a", "b"]);
    expect(map.get("b")).toEqual(["a"]);
    expect(map.get("a")).toEqual([]);
  });

  it("keeps locked layers selected but excludes them from a multi-layer drag payload", () => {
    const tree: LayersPanelNode[] = [
      { id: "unlocked", name: "Unlocked" },
      { id: "locked", name: "Locked", locked: true },
    ];
    const allRows = flattenRows(tree, new Set(), true);

    expect(
      getDraggedLayerIdsForRows({
        selectedIds: ["locked", "unlocked"],
        nodeId: "unlocked",
        visibleRows: allRows,
        ancestorIdMap: buildAncestorIdMap(tree),
        nodeById: buildLayerNodeMap(tree),
      }),
    ).toEqual(["unlocked"]);
  });

  it("orders selected rows from the full tree even when search/collapse hides one", () => {
    const tree: LayersPanelNode[] = [
      { id: "first-dom", name: "First DOM" },
      { id: "middle-dom", name: "Middle DOM" },
      { id: "last-dom", name: "Last DOM" },
    ];
    const visibleRows = [row("middle-dom")];
    const allRows = flattenRows(tree, new Set(), true);

    expect(
      getDraggedLayerIdsForRows({
        selectedIds: ["first-dom", "last-dom", "middle-dom"],
        nodeId: "middle-dom",
        visibleRows: allRows,
        ancestorIdMap: buildAncestorIdMap(tree),
        nodeById: buildLayerNodeMap(tree),
      }),
    ).toEqual(["last-dom", "middle-dom", "first-dom"]);
    // Documents the bug: visible-only ordering appended the hidden row in
    // selection order instead of its deterministic full-tree position.
    expect(
      getDraggedLayerIdsForRows({
        selectedIds: ["first-dom", "last-dom", "middle-dom"],
        nodeId: "middle-dom",
        visibleRows,
      }),
    ).toEqual(["middle-dom", "first-dom", "last-dom"]);
  });
});

describe("LayersPanel auto-expand ancestors of selection (L1)", () => {
  it("adds missing ancestors of the selection to the expanded set", () => {
    expect(
      nextAutoExpandedIds({
        selectedAncestorIds: ["parent", "grandparent"],
        expandedIds: ["grandparent"],
      }),
    ).toEqual(["grandparent", "parent"]);
  });

  it("returns null (no change) when all ancestors are already expanded", () => {
    expect(
      nextAutoExpandedIds({
        selectedAncestorIds: ["parent"],
        expandedIds: ["parent", "other"],
      }),
    ).toBeNull();
  });

  it("returns null when the selection has no ancestors (e.g. a top-level selection)", () => {
    expect(
      nextAutoExpandedIds({
        selectedAncestorIds: [],
        expandedIds: ["anything"],
      }),
    ).toBeNull();
  });

  it("L1 regression: does NOT force-re-add an ancestor the user just collapsed, when called with the CURRENT (post-collapse) expandedIds", () => {
    // Simulates the bug: user selects a deeply nested layer (parent auto-expands),
    // then manually collapses "parent". The effect's ref-gate (tested via the
    // component, not here) ensures this function only runs again on a NEW
    // selection signature — but even if called again with the same ancestors
    // and the now-collapsed expandedIds, this pure function's contract is
    // simply "compute the union"; the actual anti-bounce fix is the caller's
    // signature-gate. This test documents that calling it again after a
    // collapse (same ancestors, ancestor no longer in expandedIds) WOULD
    // re-add it — which is exactly why the effect must not call this on
    // every expandedIds change, only on selection change.
    expect(
      nextAutoExpandedIds({
        selectedAncestorIds: ["parent"],
        expandedIds: [], // "parent" was just collapsed
      }),
    ).toEqual(["parent"]);
  });
});

describe("LayersPanel shift-range selection normalization (L14)", () => {
  it("drops a descendant from the selection when its ancestor is also selected", () => {
    const rows = [row("parent"), row("child", ["parent"])];
    expect(
      dropDescendantsOfSelectedAncestors(["parent", "child"], rows),
    ).toEqual(["parent"]);
  });

  it("keeps ids whose ancestor is not part of the selection", () => {
    const rows = [row("parent"), row("child", ["parent"]), row("unrelated")];
    expect(
      dropDescendantsOfSelectedAncestors(["child", "unrelated"], rows),
    ).toEqual(["child", "unrelated"]);
  });

  it("preserves order of the surviving ids", () => {
    const rows = [row("a"), row("b"), row("child-of-a", ["a"])];
    expect(
      dropDescendantsOfSelectedAncestors(["a", "b", "child-of-a"], rows),
    ).toEqual(["a", "b"]);
  });
});

describe("BUG-LAYERS-MULTISELECT — computeLayerMultiSelectIds (Cmd/Ctrl+Click toggle, Shift+Click range)", () => {
  const VISIBLE_IDS = ["a", "b", "c", "d", "e"];
  const rows = VISIBLE_IDS.map((id) => row(id));

  it("plain click replaces the selection with just the clicked row", () => {
    const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
      id: "b",
      additive: false,
      range: false,
      currentSelectedIds: ["a", "c"],
      anchor: "a",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(nextIds).toEqual(["b"]);
    expect(nextAnchor).toBe("b");
  });

  it("Cmd/Ctrl+Click (additive, no shift) ADDS an unselected row to the selection", () => {
    const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
      id: "c",
      additive: true,
      range: false,
      currentSelectedIds: ["a", "b"],
      anchor: "a",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(nextIds).toEqual(["a", "b", "c"]);
    // Plain additive (non-range) clicks still advance the anchor, matching
    // Figma: the next Shift+Click pivots from the row you just Cmd-clicked.
    expect(nextAnchor).toBe("c");
  });

  it("Cmd/Ctrl+Click (additive, no shift) REMOVES an already-selected row (toggle off)", () => {
    const { nextIds } = computeLayerMultiSelectIds({
      id: "b",
      additive: true,
      range: false,
      currentSelectedIds: ["a", "b", "c"],
      anchor: "a",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(nextIds).toEqual(["a", "c"]);
  });

  it("Shift+Click selects the visible range between the anchor and the clicked row (anchor before target)", () => {
    const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
      id: "d",
      additive: false,
      range: true,
      currentSelectedIds: ["b"],
      anchor: "b",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(nextIds).toEqual(["b", "c", "d"]);
    // Range clicks never move the anchor — the pivot stays fixed so a
    // second Shift+Click extends/shrinks from the SAME row.
    expect(nextAnchor).toBe("b");
  });

  it("Shift+Click selects the visible range when the clicked row is BEFORE the anchor", () => {
    const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
      id: "a",
      additive: false,
      range: true,
      currentSelectedIds: ["d"],
      anchor: "d",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(nextIds).toEqual(["a", "b", "c", "d"]);
    expect(nextAnchor).toBe("d");
  });

  it("a second Shift+Click from the SAME anchor shrinks the range instead of compounding it", () => {
    // First Shift+Click: anchor "a" -> clicked "d".
    const first = computeLayerMultiSelectIds({
      id: "d",
      additive: false,
      range: true,
      currentSelectedIds: ["a"],
      anchor: "a",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(first.nextIds).toEqual(["a", "b", "c", "d"]);
    expect(first.nextAnchor).toBe("a");

    // Second Shift+Click, still pivoting from "a" (not from "d") — matches
    // Figma: consecutive range clicks re-slice from the fixed anchor.
    const second = computeLayerMultiSelectIds({
      id: "b",
      additive: false,
      range: true,
      currentSelectedIds: first.nextIds,
      anchor: first.nextAnchor,
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(second.nextIds).toEqual(["a", "b"]);
    expect(second.nextAnchor).toBe("a");
  });

  it("Cmd/Ctrl+Shift+Click (additive range) MERGES the new range into the existing selection instead of replacing it", () => {
    const { nextIds } = computeLayerMultiSelectIds({
      id: "d",
      additive: true,
      range: true,
      currentSelectedIds: ["a"],
      anchor: "a",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    // "a" was already selected and stays; b/c/d get added by the range.
    expect(nextIds).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to the last still-visible selected row when the anchor is stale (deleted/filtered out of view)", () => {
    const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
      id: "d",
      additive: false,
      range: true,
      currentSelectedIds: ["stale-anchor", "b"],
      anchor: "stale-anchor", // no longer in selectableVisibleIds
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    // Re-pivots from "b" (the last still-visible selected row) instead of
    // collapsing to a single select.
    expect(nextIds).toEqual(["b", "c", "d"]);
    expect(nextAnchor).toBe("b");
  });

  it("Shift+Click with no prior anchor at all falls through to a plain single select", () => {
    const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
      id: "c",
      additive: false,
      range: true,
      currentSelectedIds: [],
      anchor: null,
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
    });
    expect(nextIds).toEqual(["c"]);
    // No anchor existed and none was established by this click (matches the
    // original ref-based behavior: the ref is only ever written on a plain
    // click or a stale-anchor fallback correction).
    expect(nextAnchor).toBeNull();
  });

  it("drops a selected descendant whose ancestor is also swept into a range (normalization still applies to range selections)", () => {
    const nestedRows = [row("a"), row("b"), row("child-of-b", ["b"])];
    const nestedVisibleIds = ["a", "b", "child-of-b"];
    const { nextIds } = computeLayerMultiSelectIds({
      id: "child-of-b",
      additive: false,
      range: true,
      currentSelectedIds: ["a"],
      anchor: "a",
      selectableVisibleIds: nestedVisibleIds,
      visibleRows: nestedRows,
    });
    expect(nextIds).toEqual(["a", "b"]);
  });

  it("uses anchorFallbackSelectedIds (the panel's own selectedIds prop) over currentSelectedIds for the stale-anchor search", () => {
    // Regression guard for the pointer-click path: handlePointerSelect passes
    // a freshly-DOM-read currentSelectedIds that can transiently diverge from
    // the panel's own selectedIds prop. The stale-anchor fallback must pivot
    // off the panel's real selection state, not the transient DOM read.
    const { nextAnchor } = computeLayerMultiSelectIds({
      id: "d",
      additive: false,
      range: true,
      currentSelectedIds: ["stale-anchor"], // transient DOM-read set
      anchor: "stale-anchor",
      selectableVisibleIds: VISIBLE_IDS,
      visibleRows: rows,
      anchorFallbackSelectedIds: ["a", "b"], // panel's real selectedIds prop
    });
    expect(nextAnchor).toBe("b");
  });
});

describe("LayersPanel row order convention (L5)", () => {
  it("flattens sibling groups in REVERSE dom order (top panel row = topmost-rendered / last DOM child)", () => {
    const nodes: LayersPanelNode[] = [
      { id: "first-dom-child", name: "first-dom-child" },
      { id: "second-dom-child", name: "second-dom-child" },
      { id: "last-dom-child", name: "last-dom-child" },
    ];
    const rows = flattenRows(nodes, new Set(), false);
    expect(rows.map((r) => r.node.id)).toEqual([
      "last-dom-child",
      "second-dom-child",
      "first-dom-child",
    ]);
  });

  it("applies the reversal recursively to nested children", () => {
    const nodes: LayersPanelNode[] = [
      {
        id: "parent",
        name: "parent",
        children: [
          { id: "child-a", name: "child-a" },
          { id: "child-b", name: "child-b" },
        ],
      },
    ];
    const rows = flattenRows(nodes, new Set(["parent"]), false);
    expect(rows.map((r) => r.node.id)).toEqual([
      "parent",
      "child-b",
      "child-a",
    ]);
  });

  it("mapPanelPlacementToDomPlacement swaps before/after and leaves inside unchanged", () => {
    expect(mapPanelPlacementToDomPlacement("before")).toBe("after");
    expect(mapPanelPlacementToDomPlacement("after")).toBe("before");
    expect(mapPanelPlacementToDomPlacement("inside")).toBe("inside");
  });

  it("maps panel move intents into DOM placement and sibling order", () => {
    expect(
      mapPanelMoveIntentToDomIntent({
        draggedIds: ["top-panel-row", "lower-panel-row"],
        targetId: "anchor",
        placement: "before",
      }),
    ).toEqual({
      draggedIds: ["lower-panel-row", "top-panel-row"],
      targetId: "anchor",
      placement: "after",
    });
    expect(
      mapPanelMoveIntentToDomIntent({
        draggedIds: ["top-panel-row", "lower-panel-row"],
        targetId: "container",
        placement: "inside",
      }),
    ).toEqual({
      draggedIds: ["lower-panel-row", "top-panel-row"],
      targetId: "container",
      placement: "inside",
    });
  });
});

describe("LayersPanel drop placement zones (L10)", () => {
  function fakeDragOverEvent(offsetFromTopPx: number, rowHeightPx = 32) {
    return {
      clientY: offsetFromTopPx,
      currentTarget: {
        getBoundingClientRect: () => ({
          top: 0,
          height: rowHeightPx,
          bottom: rowHeightPx,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON() {
            return {};
          },
        }),
      },
    } as unknown as DragEvent<HTMLDivElement>;
  }

  it("bottom zone resolves to 'after' for a collapsed or childless row", () => {
    expect(dropPlacementForEvent(fakeDragOverEvent(30, 32), true, false)).toBe(
      "after",
    );
  });

  it("bottom zone resolves to 'inside' for an EXPANDED container with children, not 'after'", () => {
    // Without the L10 fix this would return "after", which visually
    // contradicts the indicator rendered between the container row and its
    // first child row.
    expect(dropPlacementForEvent(fakeDragOverEvent(30, 32), true, true)).toBe(
      "inside",
    );
  });

  it("top zone always resolves to 'before' regardless of expanded state", () => {
    expect(dropPlacementForEvent(fakeDragOverEvent(2, 32), true, true)).toBe(
      "before",
    );
  });

  it("middle zone resolves to 'inside' when the row can accept children", () => {
    expect(dropPlacementForEvent(fakeDragOverEvent(16, 32), true, false)).toBe(
      "inside",
    );
  });
});

describe("LayersPanel external rename trigger (L12: findNodeWithAncestors)", () => {
  // This is the pure lookup beginRename uses to validate an externally
  // requested rename target and compute which ancestors must be expanded for
  // the row to become visible — see beginRename in LayersPanel.tsx.
  const tree: LayersPanelNode[] = [
    {
      id: "frame-1",
      name: "Frame 1",
      type: "frame",
      children: [
        {
          id: "group-1",
          name: "Group 1",
          type: "group",
          children: [{ id: "text-1", name: "Text 1", type: "text" }],
        },
        {
          id: "locked-name",
          name: "Locked Name",
          type: "text",
          renamable: false,
        },
      ],
    },
  ];

  it("finds a deeply nested layer and reports its ancestor chain for expansion", () => {
    expect(findNodeWithAncestors(tree, "text-1")).toEqual({
      node: { id: "text-1", name: "Text 1", type: "text" },
      ancestorIds: ["frame-1", "group-1"],
    });
  });

  it("finds a top-level layer with an empty ancestor chain", () => {
    expect(findNodeWithAncestors(tree, "frame-1")).toEqual({
      node: tree[0],
      ancestorIds: [],
    });
  });

  it("returns null for an id that isn't in the tree, so beginRename can report false", () => {
    expect(findNodeWithAncestors(tree, "does-not-exist")).toBeNull();
  });

  it("still finds a renamable:false node — beginRename itself gates on that flag", () => {
    // findNodeWithAncestors is a plain lookup; it's beginRename's job to
    // check node.renamable and return false without starting the rename.
    const found = findNodeWithAncestors(tree, "locked-name");
    expect(found?.node.renamable).toBe(false);
  });
});

describe("LayersPanel alt-click expand/collapse subtree (collectDescendantContainerIds)", () => {
  it("collects the node itself plus every descendant that has children", () => {
    const tree: LayersPanelNode = {
      id: "frame-1",
      name: "Frame 1",
      children: [
        {
          id: "group-1",
          name: "Group 1",
          children: [
            { id: "text-1", name: "Text 1" },
            {
              id: "group-2",
              name: "Group 2",
              children: [{ id: "text-2", name: "Text 2" }],
            },
          ],
        },
        { id: "leaf-1", name: "Leaf 1" },
      ],
    };
    expect(collectDescendantContainerIds(tree)).toEqual([
      "frame-1",
      "group-1",
      "group-2",
    ]);
  });

  it("returns just the node id when it has no children", () => {
    const leaf: LayersPanelNode = { id: "leaf", name: "Leaf" };
    expect(collectDescendantContainerIds(leaf)).toEqual([]);
  });

  it("returns an empty array for a node whose children array is empty", () => {
    const emptyContainer: LayersPanelNode = {
      id: "empty",
      name: "Empty",
      children: [],
    };
    expect(collectDescendantContainerIds(emptyContainer)).toEqual([]);
  });
});

describe("LayersPanel alt-click expand/collapse subtree (nextExpandedIdsForSubtree)", () => {
  const tree: LayersPanelNode = {
    id: "frame-1",
    name: "Frame 1",
    children: [
      {
        id: "group-1",
        name: "Group 1",
        children: [
          {
            id: "group-2",
            name: "Group 2",
            children: [{ id: "text-1", name: "Text 1" }],
          },
        ],
      },
    ],
  };

  it("expands the node and every nested container in ONE batched update", () => {
    const next = nextExpandedIdsForSubtree([], tree, true);
    expect(new Set(next)).toEqual(new Set(["frame-1", "group-1", "group-2"]));
  });

  it("collapses the node and every nested container in one batched update", () => {
    const next = nextExpandedIdsForSubtree(
      ["frame-1", "group-1", "group-2", "unrelated"],
      tree,
      false,
    );
    expect(next).toEqual(["unrelated"]);
  });

  it("preserves ids unrelated to the subtree when expanding", () => {
    const next = nextExpandedIdsForSubtree(["other-node"], tree, true);
    expect(new Set(next)).toEqual(
      new Set(["other-node", "frame-1", "group-1", "group-2"]),
    );
  });
});

describe("LayersPanel row context-menu target resolution (getContextMenuTargetIds)", () => {
  const rows = [
    row("parent"),
    row("first", ["parent"]),
    row("second", ["parent"]),
    row("third", ["parent"]),
  ];

  it("operates on just the right-clicked row when it is NOT part of the current selection", () => {
    expect(
      getContextMenuTargetIds({
        selectedIds: ["first"],
        nodeId: "second",
        visibleRows: rows,
      }),
    ).toEqual(["second"]);
  });

  it("operates on the whole current selection when the right-clicked row IS part of it", () => {
    expect(
      getContextMenuTargetIds({
        selectedIds: ["third", "first"],
        nodeId: "first",
        visibleRows: rows,
      }),
    ).toEqual(["first", "third"]);
  });

  it("normalizes the returned selection to visible tree order", () => {
    expect(
      getContextMenuTargetIds({
        selectedIds: ["third", "second", "first"],
        nodeId: "third",
        visibleRows: rows,
      }),
    ).toEqual(["first", "second", "third"]);
  });
});
