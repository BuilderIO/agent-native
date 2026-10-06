import { describe, expect, it } from "vitest";

import { explicitCanvasDimensionsFromPrompt } from "./canvas-dimensions.js";

describe("explicitCanvasDimensionsFromPrompt", () => {
  it.each([
    ["Create an Instagram post at 1080×1080", { width: 1080, height: 1080 }],
    ["Make a 300x250 ad", { width: 300, height: 250 }],
    ["Use exact dimensions: 96 by 96", { width: 96, height: 96 }],
    ["Create a 1,200 x 675 pixel email banner", { width: 1200, height: 675 }],
  ])("reads the requested size from %s", (prompt, dimensions) => {
    expect(explicitCanvasDimensionsFromPrompt(prompt)).toEqual(dimensions);
  });

  it("does not mistake a small grid for a canvas size", () => {
    expect(explicitCanvasDimensionsFromPrompt("Create a 2x2 card grid")).toBe(
      undefined,
    );
  });
});
