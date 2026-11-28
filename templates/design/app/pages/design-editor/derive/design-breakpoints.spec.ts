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
    const missing = deriveDesignBreakpoints({});
    expect(missing).toEqual([]);
    expect(deriveDesignBreakpoints({ breakpointSet: [] })).toBe(missing);
    expect(deriveDesignBreakpoints({ breakpointSet: { id: "x" } })).toBe(
      missing,
    );
  });

  it("drops invalid widths, blank ids, and duplicates while trimming labels", () => {
    expect(
      deriveDesignBreakpoints({
        breakpointSet: {
          id: "set",
          breakpoints: [
            { id: "  ", widthPx: 640, label: "Blank id" },
            { id: "zero", widthPx: 0, label: "Zero" },
            { id: "neg", widthPx: -390, label: "Negative" },
            { id: "m", widthPx: 390, label: "  Phone  " },
            { id: "m", widthPx: 810, label: "Duplicate id" },
            { id: "m-dup-width", widthPx: 390, label: "Duplicate width" },
            { id: "t", widthPx: 810, label: "Tablet" },
          ],
        },
      }),
    ).toEqual([
      { id: "m", widthPx: 390, label: "Phone" },
      { id: "t", widthPx: 810, label: "Tablet" },
    ]);
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
    expect(
      applyOptimisticBreakpointAdd(added, {
        id: "t",
        label: "Same id",
        widthPx: 900,
      }),
    ).toBe(added);
    expect(
      applyOptimisticBreakpointAdd(added, {
        id: "invalid-width",
        label: "Bad",
        widthPx: 0,
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
