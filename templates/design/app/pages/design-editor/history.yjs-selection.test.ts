import { describe, expect, it } from "vitest";

import {
  captureYjsUndoStackTop,
  readYjsUndoSelection,
  stampYjsUndoSelection,
  YJS_UNDO_SELECTION_META_KEY,
} from "@/pages/design-editor/history";

function fakeUndoManager(stackSize: number) {
  return {
    undoStack: Array.from({ length: stackSize }, () => ({
      meta: new Map<unknown, unknown>(),
    })),
  };
}

describe("captureYjsUndoStackTop / stampYjsUndoSelection / readYjsUndoSelection", () => {
  it("stamps the NEW item once a write actually pushed one", () => {
    const um = fakeUndoManager(1);
    const before = captureYjsUndoStackTop(um as any);
    const snapshot = {
      selectedElement: { selector: "#box-a" } as any,
      selectedLayerIds: ["box-a"],
    };
    um.undoStack.push({ meta: new Map() });

    stampYjsUndoSelection(um as any, before, snapshot);

    expect(readYjsUndoSelection(um.undoStack[1])).toEqual(snapshot);
    expect(readYjsUndoSelection(um.undoStack[0])).toBeUndefined();
  });

  it("leaves the existing stamp untouched when the write coalesced into the SAME top item (captureTimeout) or wrote nothing", () => {
    const um = fakeUndoManager(1);
    um.undoStack[0]!.meta.set(YJS_UNDO_SELECTION_META_KEY, "earlier-gesture");
    const before = captureYjsUndoStackTop(um as any);

    stampYjsUndoSelection(um as any, before, {
      selectedElement: null,
      selectedLayerIds: ["box-b"],
    });

    expect(readYjsUndoSelection(um.undoStack[0])).toBe("earlier-gesture");
  });

  it("is a no-op when there is no undo manager or an empty stack", () => {
    expect(() =>
      stampYjsUndoSelection(null, undefined, {
        selectedElement: null,
        selectedLayerIds: [],
      }),
    ).not.toThrow();
    const empty = fakeUndoManager(0);
    const before = captureYjsUndoStackTop(empty as any);
    expect(() =>
      stampYjsUndoSelection(empty as any, before, {
        selectedElement: null,
        selectedLayerIds: [],
      }),
    ).not.toThrow();
    expect(readYjsUndoSelection(empty.undoStack[0])).toBeUndefined();
  });

  it("returns undefined for a stack item nothing stamped", () => {
    expect(readYjsUndoSelection({ meta: new Map() })).toBeUndefined();
    expect(readYjsUndoSelection(null)).toBeUndefined();
    expect(readYjsUndoSelection(undefined)).toBeUndefined();
  });
});
