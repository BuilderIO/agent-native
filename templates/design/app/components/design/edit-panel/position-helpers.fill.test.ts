import { describe, expect, it } from "vitest";

import { colorHasVisibleAlpha } from "./position-helpers";

describe("colorHasVisibleAlpha", () => {
  it("treats an SVG `none` paint as no fill, so an open pen path shows an empty Fill section", () => {
    expect(colorHasVisibleAlpha("none")).toBe(false);
  });

  it("still counts unparsed but real paints as visible", () => {
    expect(colorHasVisibleAlpha("currentColor")).toBe(true);
    expect(colorHasVisibleAlpha("rgb(0 0 0)")).toBe(true);
    expect(colorHasVisibleAlpha("transparent")).toBe(false);
  });
});
