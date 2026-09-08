import { describe, expect, it } from "vitest";

import { nextRowDragOverIndex, resolveRowDrop } from "./inspector-controls";

// ---------------------------------------------------------------------------
// nextRowDragOverIndex — drop-indicator target row for a dragover event.
// ---------------------------------------------------------------------------

describe("nextRowDragOverIndex", () => {
  it("reports the hovered row when it differs from the dragged row", () => {
    expect(nextRowDragOverIndex(2, 0)).toBe(2);
    expect(nextRowDragOverIndex(0, 2)).toBe(0);
  });

  it("clears the indicator (null) when hovering back over the dragged row itself", () => {
    // Regression guard: this used to echo back `hoverIndex` unconditionally,
    // which meant re-entering the source row mid-drag rendered a stray
    // "before" drop-indicator line on the very row being dragged (dropping
    // there is always a no-op per resolveRowDrop).
    expect(nextRowDragOverIndex(1, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRowDrop — from/to validation at drop time. Both directions
// (dragging a row down past later rows, and up past earlier rows) must
// resolve to the same {from,to} pair the caller's array-splice logic
// expects; also guards against a stale `from` once the live array has
// shrunk mid-drag.
// ---------------------------------------------------------------------------

describe("resolveRowDrop", () => {
  it("resolves a downward drag (from < to)", () => {
    expect(resolveRowDrop(0, 2, 4)).toEqual({ from: 0, to: 2 });
  });

  it("resolves an upward drag (from > to)", () => {
    expect(resolveRowDrop(3, 1, 4)).toEqual({ from: 3, to: 1 });
  });

  it("is a no-op when dropped on the same row it started from", () => {
    expect(resolveRowDrop(2, 2, 4)).toBeNull();
  });

  it("is a no-op when there is no active drag", () => {
    expect(resolveRowDrop(null, 2, 4)).toBeNull();
  });

  it("rejects a `to` that is out of range against the live count", () => {
    expect(resolveRowDrop(0, 5, 4)).toBeNull();
    expect(resolveRowDrop(0, -1, 4)).toBeNull();
  });

  it("rejects a stale `from` that is out of range against the live count", () => {
    // Regression guard: the underlying array can shrink mid-drag (e.g. an
    // external update removes rows while the pointer is still down). The
    // drop handler used to only re-validate `to` against the live count,
    // letting a `from` captured at drag-start (before the shrink) reach the
    // caller's onReorder out of bounds.
    expect(resolveRowDrop(4, 1, 3)).toBeNull();
  });
});
