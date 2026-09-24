/**
 * DesignEditor.resizeUndoFallback.spec.ts
 *
 * BUG-UNDO-RESIZE-STACK regression — Cmd+Z stopped undoing a canvas
 * resize-drag at all.
 *
 * Every content-mutating commit path in DesignEditor.tsx that goes through
 * the Yjs UndoManager (`applyLocalContentUpdate`, `applyFileContentUpdate`)
 * ALSO mirrors its before/after pair into `localContentUndoStackRef` via
 * `recordLocalContentHistoryChangeFallback` (which wraps
 * `mergeLocalContentHistoryFallback`). This mirror exists specifically
 * because the Yjs UndoManager (and its whole undo stack) is destroyed and
 * recreated whenever `docId` changes — a view-mode switch, a zoom-triggered
 * re-render, or a breakpoint switch — and handleUndo falls back to this local
 * stack once `undoManagerRef.current?.canUndo()` is false.
 *
 * `commitVisualStyles` — the ONE commit path a gesture-driven resize/style
 * drag goes through — wrote directly to the Y.Doc but never called this
 * mirror. So the moment the UndoManager was torn down for any of the above
 * reasons between the resize-drag and the user's Cmd+Z, there was NOTHING
 * left to undo: not in Yjs (destroyed), not in the local fallback stack
 * (never populated for this commit path). Cmd+Z silently did nothing, no
 * matter how many times it was pressed.
 *
 * These tests pin the pure mechanism `commitVisualStyles` now drives the same
 * way every other commit path already did: "before" (old, buggy) simulates a
 * resize commit that never mirrors to the local stack; "after" (fixed)
 * simulates the same commit calling `recordLocalContentHistoryChangeFallback`,
 * matching the new `else if (yjsHistoryAvailable ...)` branch added to
 * `commitVisualStyles`.
 */
import { describe, expect, it } from "vitest";

import {
  findLastContentHistoryChangeIndex,
  mergeLocalContentHistoryFallback,
  type ContentHistoryChange,
} from "./design-editor/history";

const FILE_ID = "screen-1";
const BEFORE_RESIZE_HTML =
  '<div id="box" style="position:absolute;left:10px;top:10px;width:100px;height:100px;"></div>';
const AFTER_RESIZE_HTML =
  '<div id="box" style="position:absolute;left:10px;top:10px;width:260px;height:180px;"></div>';

function simulateYjsUndoManagerTornDown() {
  // Mirrors handleUndo's `um?.canUndo()` going false after a view-mode
  // switch / zoom change destroys and recreates the UndoManager (see the
  // useEffect on undoManagerRef in DesignEditor.tsx) — its whole stack is
  // gone, so handleUndo must fall back to localContentUndoStackRef.
  return { canUndo: () => false };
}

describe("resize-drag undo — local fallback mirror (BUG-UNDO-RESIZE-STACK)", () => {
  it("BEFORE FIX: a resize commit that never mirrors leaves nothing to recover once the Yjs stack is gone", () => {
    // Old commitVisualStyles: only recorded into the local fallback stack
    // when yjsHistoryAvailable was FALSE. For a single-screen gesture commit
    // (yjsHistoryAvailable === true), the local stack was never touched.
    let localContentUndoStack: ContentHistoryChange[] = [];

    const um = simulateYjsUndoManagerTornDown();
    expect(um.canUndo()).toBe(false);

    // handleUndo's fallback lookup finds nothing for this file — Cmd+Z is a
    // total no-op, reproducing "DOM stays at new size after 2 presses".
    const recoverableIndex = findLastContentHistoryChangeIndex(
      localContentUndoStack,
      FILE_ID,
    );
    expect(recoverableIndex).toBe(-1);
  });

  it("AFTER FIX: commitVisualStyles' local mirror lets handleUndo recover the pre-resize content", () => {
    let localContentUndoStack: ContentHistoryChange[] = [];

    // This is exactly the new `else if (yjsHistoryAvailable ...)` branch in
    // commitVisualStyles: mirror the same before/after commitVisualStyles
    // just wrote into the Y.Doc.
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
    // The recovered content is the pre-resize box size, not the resized one.
    expect(entry?.before).toContain("width:100px;height:100px");
    expect(entry?.before).not.toContain("width:260px");
  });

  it("mirrors consecutive resize ticks (onMove-style coalescing) as a single undoable step, matching mergeLocalContentHistoryFallback's chaining contract", () => {
    let localContentUndoStack: ContentHistoryChange[] = [];
    const midDragHtml =
      '<div id="box" style="position:absolute;left:10px;top:10px;width:200px;height:150px;"></div>';

    // First tick of the same gesture.
    localContentUndoStack = mergeLocalContentHistoryFallback(
      localContentUndoStack,
      { fileId: FILE_ID, before: BEFORE_RESIZE_HTML, after: midDragHtml },
    );
    // Second tick chains off the first tick's "after" (same fileId), so the
    // whole gesture still undoes in ONE step back to the true pre-drag size.
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
