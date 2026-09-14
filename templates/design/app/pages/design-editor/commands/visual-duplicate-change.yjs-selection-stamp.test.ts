import { buildCodeLayerProjection } from "@shared/code-layer";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import { readYjsUndoSelection } from "@/pages/design-editor/history";

import { runVisualDuplicateChange } from "./visual-duplicate-change";

/**
 * Figma parity — "one undo after alt-drag removes the copy and restores
 * selection to the original" (parity-alt-drag-duplicate.spec.ts). Undo can
 * only restore what the duplicate itself captured; this proves the
 * duplicate's content write stamps the ORIGINAL element's selection (not
 * whatever `selectedElement`/`selectedLayerIdsState` currently say) onto the
 * Yjs undo-stack item its own write just created.
 *
 * The live selectedElement/selectedLayerIdsState props are the WRONG source
 * for this snapshot: the bridge reselects the clone the instant alt-drag
 * creates it, at gesture START — well before this persist runs at gesture
 * END — so by the time runVisualDuplicateChange executes, host selection
 * state already IS the copy. Both fixture cases below set
 * selectedElement/selectedLayerIdsState to the COPY (as the real gesture
 * would have left them) to prove the stamp ignores that and derives the
 * original from `targetNode` instead.
 */
const CONTENT = `<!doctype html><html><body><div id="rect" data-agent-native-node-id="rect"></div></body></html>`;

function baseArgs(overrides: {
  undoManagerRef: { current: { undoStack: any[] } };
  applyLocalContentUpdate: ReturnType<typeof vi.fn>;
}) {
  // What host selection state actually is by gesture end: the bridge has
  // already moved it onto the not-yet-persisted clone.
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
  const projection = buildCodeLayerProjection(CONTENT);
  const rectNode = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "rect",
  )!;
  return {
    selectedElement: elementInfoFromCodeLayerNode(rectNode),
    selectedLayerIds: [rectNode.id],
  };
}

describe("runVisualDuplicateChange — stamps the pre-duplicate (original) selection for undo", () => {
  it("stamps the ORIGINAL node's selection onto a NEW undo-stack item, not the stale copy selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    // Simulates a real Yjs write: the content edit pushes a fresh stack item.
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
    expect(readYjsUndoSelection(newItem)).toEqual(expectedOriginalSelection());
    expect(readYjsUndoSelection(priorItem)).toBeUndefined();
  });

  it("does not stamp (or touch the existing stamp) when the write coalesces into the existing stack top", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    priorItem.meta.set("design-editor-selection-before", "earlier-gesture");
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    // Simulates a Yjs write that coalesced into the existing top
    // (captureTimeout) rather than pushing a new stack item.
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
