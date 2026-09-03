import { describe, expect, it } from "vitest";

import {
  applyMove,
  jumpCell,
  moveCell,
  pasteTargets,
  resolveGridKey,
  selectionRange,
  type GridKeyEvent,
} from "./navigation";

function key(overrides: Partial<GridKeyEvent> & { key: string }): GridKeyEvent {
  return {
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

const bounds = { rows: 3, cols: 4 };

describe("resolveGridKey — not editing", () => {
  const state = { editing: false };

  it("moves on arrows and extends with shift", () => {
    expect(resolveGridKey(key({ key: "ArrowDown" }), state)).toEqual({
      type: "move",
      direction: "down",
      extend: false,
    });
    expect(
      resolveGridKey(key({ key: "ArrowRight", shiftKey: true }), state),
    ).toEqual({ type: "move", direction: "right", extend: true });
  });

  it("treats Tab as a horizontal move", () => {
    expect(resolveGridKey(key({ key: "Tab" }), state)).toEqual({
      type: "move",
      direction: "right",
      extend: false,
    });
    expect(resolveGridKey(key({ key: "Tab", shiftKey: true }), state)).toEqual({
      type: "move",
      direction: "left",
      extend: false,
    });
  });

  it("opens the editor on Enter and on any printable character", () => {
    expect(resolveGridKey(key({ key: "Enter" }), state)).toEqual({
      type: "edit",
    });
    expect(resolveGridKey(key({ key: "a" }), state)).toEqual({
      type: "type",
      text: "a",
    });
    expect(resolveGridKey(key({ key: "ü" }), state)).toEqual({
      type: "type",
      text: "ü",
    });
  });

  it("does not confuse a shortcut with typing", () => {
    expect(resolveGridKey(key({ key: "c", metaKey: true }), state)).toEqual({
      type: "copy",
    });
    expect(resolveGridKey(key({ key: "v", ctrlKey: true }), state)).toEqual({
      type: "paste",
    });
    expect(resolveGridKey(key({ key: "a", metaKey: true }), state)).toEqual({
      type: "selectAll",
    });
  });

  it("jumps to an edge with the modifier held", () => {
    expect(
      resolveGridKey(key({ key: "ArrowDown", metaKey: true }), state),
    ).toEqual({ type: "jump", edge: "bottom", extend: false });
  });

  it("clears the selection on Delete", () => {
    expect(resolveGridKey(key({ key: "Backspace" }), state)).toEqual({
      type: "clear",
    });
  });

  it("ignores keys it has no meaning for", () => {
    expect(resolveGridKey(key({ key: "F5" }), state)).toBeNull();
  });
});

describe("resolveGridKey — editing", () => {
  const state = { editing: true };

  it("commits down on Enter and right on Tab", () => {
    expect(resolveGridKey(key({ key: "Enter" }), state)).toEqual({
      type: "commit",
      direction: "down",
    });
    expect(
      resolveGridKey(key({ key: "Enter", shiftKey: true }), state),
    ).toEqual({ type: "commit", direction: "up" });
    expect(resolveGridKey(key({ key: "Tab" }), state)).toEqual({
      type: "commit",
      direction: "right",
    });
    expect(resolveGridKey(key({ key: "Tab", shiftKey: true }), state)).toEqual({
      type: "commit",
      direction: "left",
    });
  });

  it("cancels on Escape", () => {
    expect(resolveGridKey(key({ key: "Escape" }), state)).toEqual({
      type: "cancel",
    });
  });

  it("leaves ordinary typing to the editor input", () => {
    expect(resolveGridKey(key({ key: "a" }), state)).toBeNull();
    expect(resolveGridKey(key({ key: "ArrowLeft" }), state)).toBeNull();
  });
});

describe("movement", () => {
  it("clamps at the edges instead of wrapping", () => {
    expect(moveCell({ row: 0, col: 0 }, "up", bounds)).toEqual({
      row: 0,
      col: 0,
    });
    expect(moveCell({ row: 2, col: 3 }, "right", bounds)).toEqual({
      row: 2,
      col: 3,
    });
    expect(moveCell({ row: 1, col: 1 }, "down", bounds)).toEqual({
      row: 2,
      col: 1,
    });
  });

  it("jumps to an edge", () => {
    expect(jumpCell({ row: 1, col: 1 }, "end", bounds)).toEqual({
      row: 1,
      col: 3,
    });
    expect(jumpCell({ row: 1, col: 1 }, "top", bounds)).toEqual({
      row: 0,
      col: 1,
    });
  });

  it("keeps the anchor while extending and collapses otherwise", () => {
    const selection = { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } };
    const extended = applyMove(selection, { row: 2, col: 1 }, true);
    expect(selectionRange(extended)).toEqual({
      top: 0,
      left: 0,
      bottom: 2,
      right: 1,
    });
    expect(applyMove(extended, { row: 1, col: 1 }, false)).toEqual({
      anchor: { row: 1, col: 1 },
      focus: { row: 1, col: 1 },
    });
  });
});

describe("paste targets", () => {
  it("anchors a paste at a single selected cell", () => {
    expect(
      pasteTargets({
        selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
        bounds,
        rows: 2,
        cols: 2,
      }),
    ).toEqual({ top: 0, left: 0, bottom: 1, right: 1 });
  });

  it("clamps a large clipboard to the selected range", () => {
    expect(
      pasteTargets({
        selection: { anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } },
        bounds,
        rows: 10,
        cols: 10,
      }),
    ).toEqual({ top: 0, left: 0, bottom: 1, right: 1 });
  });

  it("never writes past the last row or column", () => {
    expect(
      pasteTargets({
        selection: { anchor: { row: 2, col: 3 }, focus: { row: 2, col: 3 } },
        bounds,
        rows: 5,
        cols: 5,
      }),
    ).toEqual({ top: 2, left: 3, bottom: 2, right: 3 });
  });
});
