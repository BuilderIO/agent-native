import { describe, expect, it } from "vitest";

import { isTabReorderNoop, resolveTabDropIndex } from "./tab-drag";

describe("resolveTabDropIndex", () => {
  it("moves right past later tabs when dropped on the right half", () => {
    expect(resolveTabDropIndex(0, 2, true)).toBe(2);
  });

  it("moves right up to a tab when dropped on the left half", () => {
    expect(resolveTabDropIndex(0, 2, false)).toBe(1);
  });

  it("moves left to a tab when dropped on the left half", () => {
    expect(resolveTabDropIndex(3, 1, false)).toBe(1);
  });

  it("moves left past a tab when dropped on the right half", () => {
    expect(resolveTabDropIndex(3, 1, true)).toBe(2);
  });

  it("is a no-op when dropped on itself", () => {
    expect(resolveTabDropIndex(2, 2, false)).toBe(2);
    expect(resolveTabDropIndex(2, 2, true)).toBe(2);
  });
});

describe("isTabReorderNoop", () => {
  it("flags identical indices as a no-op", () => {
    expect(isTabReorderNoop(2, 2)).toBe(true);
  });

  it("flags negative indices as a no-op", () => {
    expect(isTabReorderNoop(-1, 2)).toBe(true);
    expect(isTabReorderNoop(2, -1)).toBe(true);
  });

  it("allows genuine moves", () => {
    expect(isTabReorderNoop(0, 3)).toBe(false);
    expect(isTabReorderNoop(3, 0)).toBe(false);
  });
});
