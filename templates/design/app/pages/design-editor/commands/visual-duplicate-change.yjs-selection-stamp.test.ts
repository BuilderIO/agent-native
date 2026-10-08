import { buildCodeLayerProjection } from "@shared/code-layer";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import { readYjsUndoSelection } from "@/pages/design-editor/history";

import { runVisualDuplicateChange } from "./visual-duplicate-change";

const CONTENT = `<!doctype html><html><body><div id="rect" data-agent-native-node-id="rect"></div></body></html>`;
const SOURCE = { kind: "design-file" as const, fileId: "file-1" };

function baseArgs(overrides: {
  undoManagerRef: { current: { undoStack: any[] } };
  applyLocalContentUpdate: ReturnType<typeof vi.fn>;
}) {
  const staleCopySelection = {
    selector: '[data-agent-native-node-id="rect-copy"]',
    sourceId: "rect-copy",
  } as any;
  return {
    args: {
      activeFile: { id: "file-1" },
      applyLocalContentUpdate: overrides.applyLocalContentUpdate,
      canEditDesign: true,
      getFreshActiveContent: () => CONTENT,
      selectedElement: staleCopySelection,
      selectedLayerIdsState: ["rect-copy"],
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: overrides.undoManagerRef,
    } as unknown as Parameters<typeof runVisualDuplicateChange>[0],
  };
}

function expectedOriginalSelection() {
  const projection = buildCodeLayerProjection(CONTENT, { source: SOURCE });
  const rectNode = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "rect",
  );
  if (!rectNode) throw new Error("Original rect fixture node is missing");
  return {
    selectedElement: elementInfoFromCodeLayerNode(rectNode),
    selectedLayerIds: [rectNode.id],
  };
}

describe("runVisualDuplicateChange — stamps the pre-duplicate (original) selection for undo", () => {
  it("stamps the ORIGINAL node's selection onto a NEW undo-stack item, not the stale copy selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    const applyLocalContentUpdate = vi.fn(() => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
    });

    const { args } = baseArgs({ undoManagerRef, applyLocalContentUpdate });

    runVisualDuplicateChange(
      args,
      '[data-agent-native-node-id="rect"]',
      '<div id="rect-copy" data-agent-native-node-id="rect-copy"></div>',
      undefined,
      { sourceId: "rect" },
    );

    const newItem = undoManagerRef.current.undoStack[1]!;
    const originalSelection = expectedOriginalSelection();
    expect(originalSelection.selectedElement.sourceId).toBe("rect");
    expect(readYjsUndoSelection(newItem)).toEqual(originalSelection);
    expect(readYjsUndoSelection(priorItem)).toBeUndefined();
  });

  it("does not stamp (or touch the existing stamp) when the write coalesces into the existing stack top", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    priorItem.meta.set("design-editor-selection-before", "earlier-gesture");
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    const applyLocalContentUpdate = vi.fn();

    const { args } = baseArgs({ undoManagerRef, applyLocalContentUpdate });

    const result = runVisualDuplicateChange(
      args,
      '[data-agent-native-node-id="rect"]',
      '<div id="rect-copy" data-agent-native-node-id="rect-copy"></div>',
      undefined,
      { sourceId: "rect" },
    );

    expect(result).toBe(true);
    expect(undoManagerRef.current.undoStack).toHaveLength(1);
    expect(readYjsUndoSelection(priorItem)).toBe("earlier-gesture");
  });
});
