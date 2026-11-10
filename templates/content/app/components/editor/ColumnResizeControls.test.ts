// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { resolveCssLength } from "./ColumnResizeControls";

describe("resolveCssLength", () => {
  it("reads the smaller side of a min() Chrome leaves unresolved", () => {
    expect(resolveCssLength("min(100%, 128px)", 600)).toBe(128);
    expect(resolveCssLength("min(100%, 128px)", 100)).toBe(100);
  });

  it("reads the larger side of a max()", () => {
    expect(resolveCssLength("max(10px, 50%)", 100)).toBe(50);
  });

  it("reads a plain length, and nothing from a keyword", () => {
    expect(resolveCssLength("128px", 600)).toBe(128);
    expect(resolveCssLength("auto", 600)).toBe(0);
  });
});
