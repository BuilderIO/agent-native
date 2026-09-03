import { describe, expect, it } from "vitest";

import { deriveDesignBreakpoints } from "./design-breakpoints";

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

  it("drops entries with a missing id or non-finite width", () => {
    expect(
      deriveDesignBreakpoints({
        breakpointSet: {
          id: "set",
          breakpoints: [
            { widthPx: 500 },
            { id: "nan", widthPx: Number.NaN },
            { id: "ok", widthPx: 600 },
          ],
        },
      }),
    ).toEqual([{ id: "ok", widthPx: 600, label: "Tablet" }]);
  });

  it("returns an empty list when no breakpoint set is present", () => {
    expect(deriveDesignBreakpoints({})).toEqual([]);
    expect(deriveDesignBreakpoints({ breakpointSet: [] })).toEqual([]);
    expect(deriveDesignBreakpoints({ breakpointSet: { id: "x" } })).toEqual([]);
  });
});
