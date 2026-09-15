import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  reserveLinkedComponentContentHistory,
  type ContentHistoryChange,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  type GeometryHistorySelection,
} from "@/pages/design-editor/history";

type OrderToken = "file-content" | "selection";

function historyRefs(
  stack: ContentHistoryEntry[] = [],
  selections: (GeometryHistorySelection | undefined)[] = [],
  order: OrderToken[] = [],
) {
  const after: { current: ContentHistorySelectionAfterMap } = {
    current: new WeakMap(),
  };
  return {
    stack: { current: stack },
    selections: { current: selections },
    order: { current: order },
    after,
  };
}

function reserve(
  refs: ReturnType<typeof historyRefs>,
  selection: GeometryHistorySelection,
) {
  return reserveLinkedComponentContentHistory({
    stack: refs.stack,
    selections: refs.selections,
    order: refs.order,
    selection,
    after: refs.after,
  });
}

function projectedNodeId(content: string, fileId: string, durableId: string) {
  const node = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId },
  }).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === durableId,
  );
  if (!node) throw new Error(`missing fixture node ${durableId}`);
  return node.id;
}

describe("linked component history reservations", () => {
  it("keeps causal stack slots and each full pre-edit selection when responses finalize out of order", () => {
    const sourceA = '<div data-agent-native-node-id="layer-a"></div>';
    const sourceB = '<div data-agent-native-node-id="layer-b"></div>';
    const afterA = '<div data-agent-native-node-id="layer-a">after A</div>';
    const afterB = '<div data-agent-native-node-id="layer-b">after B</div>';
    const selectionA: GeometryHistorySelection = {
      activeFileId: "file-a",
      overviewSelectedScreenIds: ["file-a", "file-b"],
      selectedLayerIds: [projectedNodeId(sourceA, "file-a", "layer-a")],
      sourceContentByFileId: { "file-a": sourceA },
      sourceFileIdByFileId: { "file-a": "file-a" },
    };
    const selectionB: GeometryHistorySelection = {
      activeFileId: "file-b",
      overviewSelectedScreenIds: ["file-b"],
      selectedLayerIds: [projectedNodeId(sourceB, "file-b", "layer-b")],
      sourceContentByFileId: { "file-b": sourceB },
      sourceFileIdByFileId: { "file-b": "file-b" },
    };
    const refs = historyRefs();
    const a = reserve(refs, selectionA);
    refs.order.current.push("selection");
    const b = reserve(refs, selectionB);

    expect(refs.order.current).toEqual([
      "file-content",
      "selection",
      "file-content",
    ]);

    b.commit([{ fileId: "file-b", before: sourceB, after: afterB }]);
    a.commit([
      { fileId: "file-a", before: sourceA, after: afterA },
      {
        fileId: "file-b",
        before: sourceB,
        after: '<div data-agent-native-node-id="layer-b">instance A</div>',
      },
    ]);

    expect(refs.stack.current).toHaveLength(2);
    expect(refs.stack.current[0]).toMatchObject({
      linkedComponent: true,
      changes: [
        { fileId: "file-a", before: sourceA, after: afterA },
        {
          fileId: "file-b",
          before: sourceB,
          after: '<div data-agent-native-node-id="layer-b">instance A</div>',
        },
      ],
    });
    expect(refs.stack.current[1]).toMatchObject({
      linkedComponent: true,
      changes: [{ fileId: "file-b", before: sourceB, after: afterB }],
    });
    expect(refs.selections.current).toEqual([
      {
        ...selectionA,
        sourceContentByFileId: { "file-a": sourceA },
        sourceFileIdByFileId: { "file-a": "file-a" },
      },
      {
        ...selectionB,
        sourceContentByFileId: { "file-b": sourceB },
        sourceFileIdByFileId: { "file-b": "file-b" },
      },
    ]);
    expect(refs.after.current.get(refs.stack.current[0]!)).toEqual({
      ...selectionA,
      sourceContentByFileId: { "file-a": afterA },
      sourceFileIdByFileId: { "file-a": "file-a" },
    });
    expect(refs.after.current.get(refs.stack.current[1]!)).toEqual({
      ...selectionB,
      sourceContentByFileId: { "file-b": afterB },
      sourceFileIdByFileId: { "file-b": "file-b" },
    });
  });

  it("cancels one slot without removing adjacent content, selection order, or another reservation", () => {
    const realChange: ContentHistoryChange = {
      fileId: "file-real",
      before: "<main>before</main>",
      after: "<main>after</main>",
    };
    const realSelection: GeometryHistorySelection = {
      activeFileId: "file-real",
      overviewSelectedScreenIds: ["file-real"],
      selectedLayerIds: ["real-layer"],
    };
    const selectionB: GeometryHistorySelection = {
      activeFileId: "file-b",
      overviewSelectedScreenIds: ["file-b"],
      selectedLayerIds: [],
    };
    const refs = historyRefs([realChange], [realSelection], ["file-content"]);
    const a = reserve(refs, {
      activeFileId: "file-a",
      overviewSelectedScreenIds: ["file-a"],
      selectedLayerIds: [],
    });
    refs.order.current.push("selection");
    const b = reserve(refs, selectionB);
    const reservedB = refs.stack.current[2]!;

    a.cancel();

    expect(refs.stack.current).toHaveLength(2);
    expect(refs.stack.current[0]).toBe(realChange);
    expect(refs.stack.current[1]).toMatchObject({
      changes: [],
      linkedComponent: true,
    });
    expect(refs.after.current.has(reservedB)).toBe(false);
    expect(refs.selections.current).toEqual([realSelection, selectionB]);
    expect(refs.order.current).toEqual([
      "file-content",
      "selection",
      "file-content",
    ]);

    b.commit([
      { fileId: "file-b", before: "<main>b0</main>", after: "<main>b1</main>" },
    ]);
    expect(refs.stack.current[0]).toBe(realChange);
    expect(refs.selections.current[0]).toBe(realSelection);
    expect(refs.order.current).toEqual([
      "file-content",
      "selection",
      "file-content",
    ]);
  });

  it("does not resurrect a reservation pruned before its response completes", () => {
    const realChange: ContentHistoryChange = {
      fileId: "file-real",
      before: "<main>before</main>",
      after: "<main>after</main>",
    };
    const realSelection: GeometryHistorySelection = {
      activeFileId: "file-real",
      overviewSelectedScreenIds: ["file-real"],
      selectedLayerIds: [],
    };
    const refs = historyRefs([realChange], [realSelection], ["file-content"]);
    const reservation = reserve(refs, {
      activeFileId: "file-a",
      overviewSelectedScreenIds: ["file-a"],
      selectedLayerIds: [],
    });
    const reserved = refs.stack.current[1]!;

    refs.stack.current = [realChange];
    refs.selections.current = [realSelection];
    refs.order.current = ["file-content"];
    reservation.commit([
      { fileId: "file-a", before: "<main>a0</main>", after: "<main>a1</main>" },
    ]);

    expect(refs.stack.current).toEqual([realChange]);
    expect(refs.selections.current).toEqual([realSelection]);
    expect(refs.order.current).toEqual(["file-content"]);
    expect(refs.after.current.has(reserved)).toBe(false);
  });
});
