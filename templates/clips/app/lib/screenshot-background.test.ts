import { describe, expect, it } from "vitest";

import { backgroundPadding, parseBackground } from "./screenshot-background";

describe("parseBackground", () => {
  it("reads a known gradient or a colour", () => {
    expect(parseBackground({ kind: "gradient", id: "sky" })).toEqual({
      kind: "gradient",
      id: "sky",
    });
    expect(parseBackground({ kind: "solid", color: "#112233" })).toEqual({
      kind: "solid",
      color: "#112233",
    });
  });

  it("treats anything else as no background", () => {
    expect(parseBackground(undefined)).toBeNull();
    expect(
      parseBackground({ kind: "gradient", id: "not-a-preset" }),
    ).toBeNull();
    expect(
      parseBackground({ kind: "solid", color: "red; background:url(x)" }),
    ).toBeNull();
  });
});

describe("backgroundPadding", () => {
  it("scales with the picture so the margin looks the same at any size", () => {
    expect(backgroundPadding({ width: 1000, height: 500 })).toBe(60);
    expect(backgroundPadding({ width: 4000, height: 2000 })).toBe(240);
  });
});
