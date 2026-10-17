import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  captureYjsUndoHistoryUpdate,
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
    stampYjsUndoSelectionAfter(um as any, true, afterSnap);

    expect(readYjsUndoSelection(um.undoStack[0])).toEqual(beforeSnap);
    expect(readYjsRedoSelection(um.undoStack[0])).toEqual(afterSnap);
  });

  it("updates the redo selection when a later create coalesces into the same item", () => {
    const um = fakeUndoManager();
    const item = { meta: new Map<unknown, unknown>() };
    const beforeSnap = {
      selectedElement: null,
      selectedLayerIds: ["before"],
    };
    const firstAfterSnap = {
      selectedElement: null,
      selectedLayerIds: ["first"],
    };
    const latestAfterSnap = {
      selectedElement: null,
      selectedLayerIds: ["second"],
    };
    item.meta.set("design-editor-selection-before", beforeSnap);
    item.meta.set("design-editor-selection-after", firstAfterSnap);
    um.undoStack.push(item);

    stampYjsUndoSelectionAfter(um as any, true, latestAfterSnap);

    expect(readYjsUndoSelection(item)).toEqual(beforeSnap);
    expect(readYjsRedoSelection(item)).toEqual(latestAfterSnap);
  });

  it("leaves an unrelated Yjs item unchanged when creation used local fallback history", () => {
    const um = fakeUndoManager();
    const item = { meta: new Map<unknown, unknown>() };
    const existingAfterSnap = {
      selectedElement: null,
      selectedLayerIds: ["earlier"],
    };
    const unrelatedAfterSnap = {
      selectedElement: null,
      selectedLayerIds: ["local-fallback-create"],
    };
    item.meta.set("design-editor-selection-after", existingAfterSnap);
    um.undoStack.push(item);

    stampYjsUndoSelectionAfter(um as any, false, unrelatedAfterSnap);

    expect(readYjsRedoSelection(item)).toEqual(existingAfterSnap);
  });
});

describe("forwardYjsUndoStackItemMeta", () => {
  it("carries a stamp forward so it survives real yjs's fresh-item undo/redo round trip", () => {
    const um = fakeUndoManager();
    um.undoStack.push({ meta: new Map() });
    const afterSnap = {
      selectedElement: { selector: "#group-1" } as any,
      selectedLayerIds: ["group-1"],
    };
    stampYjsUndoSelectionAfter(um as any, true, afterSnap);

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

describe("captureYjsUndoHistoryUpdate", () => {
  it("reports added and coalesced items, but not a fallback-only operation", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    const undoManager = new Y.UndoManager(text, {
      trackedOrigins: new Set(["local"]),
      captureTimeout: 60_000,
    });

    const added = captureYjsUndoHistoryUpdate(undoManager, () => {
      doc.transact(() => text.insert(0, "a"), "local");
      return "added";
    });
    const firstItem = undoManager.undoStack[0];
    const updated = captureYjsUndoHistoryUpdate(undoManager, () => {
      doc.transact(() => text.insert(1, "b"), "local");
      return "updated";
    });
    const fallback = captureYjsUndoHistoryUpdate(undoManager, () => "fallback");

    expect(added).toEqual({ result: "added", recorded: true });
    expect(updated).toEqual({ result: "updated", recorded: true });
    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0]).toBe(firstItem);
    expect(fallback).toEqual({ result: "fallback", recorded: false });

    undoManager.destroy();
    doc.destroy();
  });
});
