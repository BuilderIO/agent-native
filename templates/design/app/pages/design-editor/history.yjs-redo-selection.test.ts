import { describe, expect, it } from "vitest";

import {
  captureYjsUndoStackTop,
  forwardYjsUndoStackItemMeta,
  readYjsRedoSelection,
  readYjsUndoSelection,
  stampYjsUndoSelection,
  stampYjsUndoSelectionAfter,
} from "@/pages/design-editor/history";

function fakeUndoManager() {
  return {
    undoStack: [] as { meta: Map<unknown, unknown> }[],
    redoStack: [] as { meta: Map<unknown, unknown> }[],
  };
}
function simulateUndo(um: ReturnType<typeof fakeUndoManager>) {
  const popped = um.undoStack.pop();
  if (!popped) return undefined;
  const fresh = { meta: new Map<unknown, unknown>() };
  um.redoStack.push(fresh);
  return popped;
}
function simulateRedo(um: ReturnType<typeof fakeUndoManager>) {
  const popped = um.redoStack.pop();
  if (!popped) return undefined;
  const fresh = { meta: new Map<unknown, unknown>() };
  um.undoStack.push(fresh);
  return popped;
}

describe("stampYjsUndoSelectionAfter / readYjsRedoSelection", () => {
  it("stamps the after-selection alongside the before-selection on the same new item", () => {
    const um = fakeUndoManager();
    const before = captureYjsUndoStackTop(um as any);
    um.undoStack.push({ meta: new Map() });
    const beforeSnap = { selectedElement: null, selectedLayerIds: ["a", "b"] };
    const afterSnap = {
      selectedElement: { selector: "#group-1" } as any,
      selectedLayerIds: ["group-1"],
    };

    stampYjsUndoSelection(um as any, before, beforeSnap);
    stampYjsUndoSelectionAfter(um as any, before, afterSnap);

    expect(readYjsUndoSelection(um.undoStack[0])).toEqual(beforeSnap);
    expect(readYjsRedoSelection(um.undoStack[0])).toEqual(afterSnap);
  });
});

describe("forwardYjsUndoStackItemMeta", () => {
  it("carries a stamp forward so it survives real yjs's fresh-item undo/redo round trip", () => {
    const um = fakeUndoManager();
    const before = captureYjsUndoStackTop(um as any);
    um.undoStack.push({ meta: new Map() });
    const afterSnap = {
      selectedElement: { selector: "#group-1" } as any,
      selectedLayerIds: ["group-1"],
    };
    stampYjsUndoSelectionAfter(um as any, before, afterSnap);

    const undone = simulateUndo(um);
    expect(readYjsRedoSelection(um.redoStack[0])).toBeUndefined();
    forwardYjsUndoStackItemMeta(undone, um.redoStack[um.redoStack.length - 1]);
    expect(readYjsRedoSelection(um.redoStack[0])).toEqual(afterSnap);

    const redone = simulateRedo(um);
    expect(readYjsRedoSelection(redone)).toEqual(afterSnap);
    forwardYjsUndoStackItemMeta(redone, um.undoStack[um.undoStack.length - 1]);
    expect(readYjsRedoSelection(um.undoStack[0])).toEqual(afterSnap);
  });

  it("is a no-op with a missing item on either side, or when they are the same object", () => {
    const item = { meta: new Map([["k", "v"]]) };
    expect(() => forwardYjsUndoStackItemMeta(undefined, item)).not.toThrow();
    expect(() => forwardYjsUndoStackItemMeta(item, undefined)).not.toThrow();
    expect(() => forwardYjsUndoStackItemMeta(item, item)).not.toThrow();
    expect(item.meta.get("k")).toBe("v");
  });
});
