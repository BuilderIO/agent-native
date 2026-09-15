import { describe, expect, it } from "vitest";

import { isComputedStyleMap } from "./element-payload";

describe("computed style bridge payloads", () => {
  it("accepts complete complex gradients and rejects malformed values", () => {
    const backgroundImage = `linear-gradient(90deg, ${Array.from({ length: 40 }, (_, index) => `rgba(120, 80, 200, 0.5) ${index}%`).join(", ")})`;
    expect(backgroundImage.length).toBeGreaterThan(512);
    expect(
      isComputedStyleMap({
        backgroundImage,
        opacity: "0.5",
        webkitBackdropFilter: undefined,
      }),
    ).toBe(true);
    expect(isComputedStyleMap({ backgroundImage, opacity: 0.5 })).toBe(false);
    expect(isComputedStyleMap(null)).toBe(false);
    expect(isComputedStyleMap([backgroundImage])).toBe(false);
  });
});
