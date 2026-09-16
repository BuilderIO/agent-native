import { describe, expect, it } from "vitest";

import { advancePresentIndex } from "./present-channel";

describe("presenter navigation fallback", () => {
  it("moves within the visible slide bounds when no presentation owner responds", () => {
    expect(advancePresentIndex(1, "next", 4)).toBe(2);
    expect(advancePresentIndex(1, "prev", 4)).toBe(0);
    expect(advancePresentIndex(3, "next", 4)).toBe(3);
    expect(advancePresentIndex(0, "prev", 4)).toBe(0);
  });

  it("clamps stale state and empty decks safely", () => {
    expect(advancePresentIndex(20, "next", 3)).toBe(2);
    expect(advancePresentIndex(-4, "prev", 3)).toBe(0);
    expect(advancePresentIndex(0, "next", 0)).toBe(0);
  });
});
