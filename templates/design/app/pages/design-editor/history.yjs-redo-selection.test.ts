import { describe, expect, it } from "vitest";

import {
  captureYjsUndoStackTop,
  forwardYjsUndoStackItemMeta,
  readYjsRedoSelection,
  readYjsUndoSelection,
  stampYjsUndoSelection,
  stampYjsUndoSelectionAfter,
} from "./history";

/** Minimal stand-in for `Y.UndoManager`, extended with the round-trip
 * behavior `forwardYjsUndoStackItemMeta` exists to compensate for: real
 * `yjs` never reuses a `StackItem` across undo/redo — undoing pops one off
 * `undoStack` and pushes a FRESH item (empty meta) onto `redoStack` for the
 * inverse transaction, and vice versa on redo. `simulateUndo`/`simulateRedo`
 * below reproduce exactly that, so a test here fails the same way the real
 * bridge would without `forwardYjsUndoStackItemMeta`. */
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

    // Undo: yjs pops the stamped item and pushes a BLANK item onto
    // redoStack. Without forwarding, that blank item is all `um.redo()`
    // will ever return — this is the redo-selection-after bug reproduced.
    const undone = simulateUndo(um);
    expect(readYjsRedoSelection(um.redoStack[0])).toBeUndefined(); // proves the bug exists without forwarding
    forwardYjsUndoStackItemMeta(undone, um.redoStack[um.redoStack.length - 1]);
    expect(readYjsRedoSelection(um.redoStack[0])).toEqual(afterSnap);

    // Redo: same story in reverse. The forwarded copy must survive too, so
    // a SECOND undo (after this redo) can still restore it.
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
