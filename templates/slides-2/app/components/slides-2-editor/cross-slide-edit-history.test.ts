import { describe, expect, it } from "vitest";

import {
  appendCrossSlideEdit,
  appendCrossSlideSourceCommit,
  clearSlideEditHistory,
  EMPTY_CROSS_SLIDE_EDIT_HISTORY,
  moveCrossSlideEditHistory,
  projectSlideEditHistory,
} from "./cross-slide-edit-history";
import type { SourceEdit } from "./types";

function edit(line: number): SourceEdit {
  return {
    line,
    column: 0,
    ops: [{ kind: "set-style", key: "left", value: `${line}px` }],
  };
}

describe("cross-slide edit history", () => {
  it("moves across slides and returns the changed element for selection", () => {
    let history = EMPTY_CROSS_SLIDE_EDIT_HISTORY;
    history = appendCrossSlideEdit(history, {
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: "a1",
      edits: [edit(10)],
      selection: { line: 10, column: 0 },
    });
    history = appendCrossSlideEdit(history, {
      slideId: "slide-b",
      sourceRevision: 1,
      sourceHash: "b1",
      edits: [edit(20)],
      selection: { line: 20, column: 0 },
    });
    expect(projectSlideEditHistory(history, "slide-a").historyIndex).toBe(1);
    expect(projectSlideEditHistory(history, "slide-b").historyIndex).toBe(1);

    const undoB = moveCrossSlideEditHistory(history, "undo");
    expect(undoB.entry).toMatchObject({
      slideId: "slide-b",
      selection: { line: 20, column: 0 },
    });
    expect(projectSlideEditHistory(undoB.history, "slide-a").historyIndex).toBe(
      1,
    );
    expect(projectSlideEditHistory(undoB.history, "slide-b").historyIndex).toBe(
      0,
    );

    const undoA = moveCrossSlideEditHistory(undoB.history, "undo");
    expect(undoA.entry).toMatchObject({
      slideId: "slide-a",
      selection: { line: 10, column: 0 },
    });
    expect(projectSlideEditHistory(undoA.history, "slide-a").historyIndex).toBe(
      0,
    );

    const redoA = moveCrossSlideEditHistory(undoA.history, "redo");
    expect(redoA.entry?.slideId).toBe("slide-a");
    expect(projectSlideEditHistory(redoA.history, "slide-a").historyIndex).toBe(
      1,
    );
    const redoB = moveCrossSlideEditHistory(redoA.history, "redo");
    expect(redoB.entry?.slideId).toBe("slide-b");
    expect(projectSlideEditHistory(redoB.history, "slide-b").historyIndex).toBe(
      1,
    );
  });

  it("truncates redo after a new edit and clears only the requested slide", () => {
    let history = EMPTY_CROSS_SLIDE_EDIT_HISTORY;
    history = appendCrossSlideEdit(history, {
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: "a1",
      edits: [edit(1)],
      selection: { line: 1, column: 0 },
    });
    history = appendCrossSlideEdit(history, {
      slideId: "slide-b",
      sourceRevision: 1,
      sourceHash: "b1",
      edits: [edit(2)],
      selection: { line: 2, column: 0 },
    });
    history = moveCrossSlideEditHistory(history, "undo").history;
    history = appendCrossSlideEdit(history, {
      slideId: "slide-c",
      sourceRevision: 1,
      sourceHash: "c1",
      edits: [edit(3)],
      selection: { line: 3, column: 0 },
    });
    expect(history.entries.map((entry) => entry.slideId)).toEqual([
      "slide-a",
      "slide-c",
    ]);

    const afterClear = clearSlideEditHistory(history, "slide-a");
    expect(afterClear.entries.map((entry) => entry.slideId)).toEqual([
      "slide-c",
    ]);
    expect(afterClear.cursor).toBe(1);
  });

  it("places a saved source change after older pending edits across slides", () => {
    let history = EMPTY_CROSS_SLIDE_EDIT_HISTORY;
    history = appendCrossSlideEdit(history, {
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: "a1",
      edits: [edit(10)],
      selection: { line: 10, column: 0 },
    });
    history = appendCrossSlideEdit(history, {
      slideId: "slide-b",
      sourceRevision: 1,
      sourceHash: "b1",
      edits: [edit(20)],
      selection: { line: 20, column: 0 },
    });

    history = appendCrossSlideSourceCommit(history, {
      slideId: "slide-b",
      beforeSourceTsx: "const slide = 'before';",
      beforeSourceHash: "b1",
      afterSourceTsx: "const slide = 'after';",
      afterSourceHash: "b2",
      selection: null,
    });

    expect(history.entries.map((entry) => entry.type)).toEqual([
      "edit",
      "commit",
    ]);
    expect(history.entries.map((entry) => entry.slideId)).toEqual([
      "slide-a",
      "slide-b",
    ]);
    expect(projectSlideEditHistory(history, "slide-a").historyIndex).toBe(1);
    expect(projectSlideEditHistory(history, "slide-b")).toEqual({
      editBatches: [],
      historyIndex: 0,
    });

    const undoCommit = moveCrossSlideEditHistory(history, "undo");
    expect(undoCommit.entry).toMatchObject({
      type: "commit",
      slideId: "slide-b",
      beforeSourceHash: "b1",
      afterSourceHash: "b2",
    });
    const undoOlderEdit = moveCrossSlideEditHistory(undoCommit.history, "undo");
    expect(undoOlderEdit.entry).toMatchObject({
      type: "edit",
      slideId: "slide-a",
      selection: { line: 10, column: 0 },
    });

    const redoOlderEdit = moveCrossSlideEditHistory(
      undoOlderEdit.history,
      "redo",
    );
    expect(redoOlderEdit.entry?.slideId).toBe("slide-a");
    const redoCommit = moveCrossSlideEditHistory(redoOlderEdit.history, "redo");
    expect(redoCommit.entry).toMatchObject({
      type: "commit",
      slideId: "slide-b",
      beforeSourceHash: "b1",
      afterSourceHash: "b2",
    });
  });

  it("folds saved pending edits and truncates the redo branch", () => {
    let history = EMPTY_CROSS_SLIDE_EDIT_HISTORY;
    history = appendCrossSlideEdit(history, {
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: "a1",
      edits: [edit(10)],
      selection: { line: 10, column: 0 },
    });
    history = appendCrossSlideEdit(history, {
      slideId: "slide-b",
      sourceRevision: 1,
      sourceHash: "b1",
      edits: [edit(20)],
      selection: { line: 20, column: 0 },
    });
    history = moveCrossSlideEditHistory(history, "undo").history;

    history = appendCrossSlideSourceCommit(history, {
      slideId: "slide-b",
      beforeSourceTsx: "const slide = 'before';",
      beforeSourceHash: "b1",
      afterSourceTsx: "const slide = 'after';",
      afterSourceHash: "b2",
      selection: null,
    });

    expect(history.entries.map((entry) => [entry.slideId, entry.type])).toEqual(
      [
        ["slide-a", "edit"],
        ["slide-b", "commit"],
      ],
    );
    expect(history.cursor).toBe(2);
  });
});
