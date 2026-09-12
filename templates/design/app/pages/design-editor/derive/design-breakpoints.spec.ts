import { describe, expect, it } from "vitest";

import {
  applyOptimisticBreakpointAdd,
  applyOptimisticBreakpointRemove,
  deriveDesignBreakpoints,
} from "./design-breakpoints";

describe("deriveDesignBreakpoints", () => {
  it("sorts by width and buckets unlabelled widths", () => {
    expect(
      deriveDesignBreakpoints({
        breakpointSet: {
          id: "set",
          breakpoints: [
            { id: "d", widthPx: 1440 },
            { id: "m", widthPx: 390 },
            { id: "t", widthPx: 768 },
          ],
        },
      }),
    ).toEqual([
      { id: "m", widthPx: 390, label: "Mobile" },
      { id: "t", widthPx: 768, label: "Tablet" },
      { id: "d", widthPx: 1440, label: "Desktop" },
    ]);
  });

  it("keeps an explicit label and ignores a blank one", () => {
    expect(
      deriveDesignBreakpoints({
        breakpointSet: {
          id: "set",
          breakpoints: [
            { id: "a", widthPx: 1024, label: "Wide" },
            { id: "b", widthPx: 1200, label: "   " },
          ],
        },
      }),
    ).toEqual([
      { id: "a", widthPx: 1024, label: "Wide" },
      { id: "b", widthPx: 1200, label: "Desktop" },
    ]);
  });

  it("returns an empty list for missing or malformed sets", () => {
    expect(deriveDesignBreakpoints({})).toEqual([]);
    expect(deriveDesignBreakpoints({ breakpointSet: [] })).toEqual([]);
    expect(deriveDesignBreakpoints({ breakpointSet: { id: "x" } })).toEqual([]);
  });
});

describe("optimistic breakpoint set patches", () => {
  it("adds a sorted breakpoint and is a no-op for duplicate widths", () => {
    const base = {
      breakpointSet: {
        id: "set",
        breakpoints: [
          { id: "m", label: "Mobile", widthPx: 390, prefix: "base" },
        ],
      },
    };
    const added = applyOptimisticBreakpointAdd(base, {
      id: "t",
      label: "Tablet",
      widthPx: 768,
    });
    expect(
      (added.breakpointSet as { breakpoints: Array<{ widthPx: number }> })
        .breakpoints,
    ).toEqual([
      expect.objectContaining({ id: "m", widthPx: 390 }),
      expect.objectContaining({ id: "t", widthPx: 768, label: "Tablet" }),
    ]);
    expect(
      applyOptimisticBreakpointAdd(added, {
        id: "dup",
        label: "Tablet",
        widthPx: 768,
      }),
    ).toBe(added);
  });

  it("removes by id and is a no-op for unknown ids", () => {
    const base = {
      breakpointSet: {
        id: "set",
        breakpoints: [
          { id: "m", label: "Mobile", widthPx: 390 },
          { id: "t", label: "Tablet", widthPx: 768 },
        ],
      },
    };
    const removed = applyOptimisticBreakpointRemove(base, "t");
    expect(
      (removed.breakpointSet as { breakpoints: Array<{ id: string }> })
        .breakpoints,
    ).toEqual([expect.objectContaining({ id: "m" })]);
    expect(applyOptimisticBreakpointRemove(removed, "missing")).toBe(removed);
  });
});
