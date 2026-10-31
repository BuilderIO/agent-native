import { describe, expect, it } from "vitest";

import { ensureUniqueSlideIds } from "./slide-ids";

describe("ensureUniqueSlideIds", () => {
  it("never gives a replacement an ID a later slide still holds", () => {
    const { slides, changed } = ensureUniqueSlideIds(
      [{ id: "a" }, { id: "a" }, { id: "slide-taken" }],
      (index, attempt) => (attempt === 0 ? "slide-taken" : `slide-${index}`),
    );

    expect(changed).toBe(true);
    expect(slides.map((slide) => slide.id)).toEqual([
      "a",
      "slide-1",
      "slide-taken",
    ]);
  });
});
