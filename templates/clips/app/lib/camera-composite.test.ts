import { describe, expect, it } from "vitest";

import { clampToMaxDimension } from "./camera-composite";

describe("clampToMaxDimension", () => {
  it("preserves dimensions that are already within the composite ceiling", () => {
    expect(clampToMaxDimension(1280, 720)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("scales 4K landscape capture to an even 1080p-class canvas", () => {
    expect(clampToMaxDimension(3840, 2160)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("preserves portrait aspect ratio while capping its longest edge", () => {
    expect(clampToMaxDimension(2160, 3840)).toEqual({
      width: 1080,
      height: 1920,
    });
  });
});
