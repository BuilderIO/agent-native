import { describe, expect, it } from "vitest";

import {
  findLastContentHistoryChangeIndex,
  mergeLocalContentHistoryFallback,
  type ContentHistoryChange,
} from "./design-editor/history";

// oracle-change: removed the BEFORE FIX case that asserted a simulated empty stack; the AFTER FIX case runs the real recovery

const FILE_ID = "screen-1";
const BEFORE_RESIZE_HTML =
  '<div id="box" style="position:absolute;left:10px;top:10px;width:100px;height:100px;"></div>';
const AFTER_RESIZE_HTML =
  '<div id="box" style="position:absolute;left:10px;top:10px;width:260px;height:180px;"></div>';

function simulateYjsUndoManagerTornDown() {
  return { canUndo: () => false };
}

describe("resize-drag undo — local fallback mirror (BUG-UNDO-RESIZE-STACK)", () => {
  it("AFTER FIX: commitVisualStyles' local mirror lets handleUndo recover the pre-resize content", () => {
    let localContentUndoStack: ContentHistoryChange[] = [];

    localContentUndoStack = mergeLocalContentHistoryFallback(
      localContentUndoStack,
      { fileId: FILE_ID, before: BEFORE_RESIZE_HTML, after: AFTER_RESIZE_HTML },
    );

    const um = simulateYjsUndoManagerTornDown();
    expect(um.canUndo()).toBe(false);

    const recoverableIndex = findLastContentHistoryChangeIndex(
      localContentUndoStack,
      FILE_ID,
    );
    expect(recoverableIndex).not.toBe(-1);

    const [entry] = localContentUndoStack.splice(recoverableIndex, 1);
    expect(entry?.before).toBe(BEFORE_RESIZE_HTML);
    expect(entry?.before).toContain("width:100px;height:100px");
    expect(entry?.before).not.toContain("width:260px");
  });

  it("mirrors consecutive resize ticks (onMove-style coalescing) as a single undoable step, matching mergeLocalContentHistoryFallback's chaining contract", () => {
    let localContentUndoStack: ContentHistoryChange[] = [];
    const midDragHtml =
      '<div id="box" style="position:absolute;left:10px;top:10px;width:200px;height:150px;"></div>';

    localContentUndoStack = mergeLocalContentHistoryFallback(
      localContentUndoStack,
      { fileId: FILE_ID, before: BEFORE_RESIZE_HTML, after: midDragHtml },
    );
    localContentUndoStack = mergeLocalContentHistoryFallback(
      localContentUndoStack,
      { fileId: FILE_ID, before: midDragHtml, after: AFTER_RESIZE_HTML },
    );

    expect(localContentUndoStack).toHaveLength(1);
    expect(localContentUndoStack[0]).toEqual({
      fileId: FILE_ID,
      before: BEFORE_RESIZE_HTML,
      after: AFTER_RESIZE_HTML,
    });
  });
});
