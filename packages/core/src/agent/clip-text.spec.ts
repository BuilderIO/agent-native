import { describe, expect, it } from "vitest";

import { clipHead, clipTail } from "./clip-text.js";

describe("clipHead", () => {
  it("returns short text untouched", () => {
    expect(clipHead("abc", 3)).toBe("abc");
    expect(clipHead("", 0)).toBe("");
  });

  it("cuts plain text at the limit", () => {
    expect(clipHead("abcdef", 4)).toBe("abcd");
    expect(clipHead("abcdef", 0)).toBe("");
  });

  it("drops half an emoji instead of keeping it", () => {
    expect(clipHead("ab😀cd", 3)).toBe("ab");
    expect(clipHead("ab😀cd", 4)).toBe("ab😀");
    expect(clipHead("😀😀", 1)).toBe("");
  });
});

describe("clipTail", () => {
  it("returns short text untouched", () => {
    expect(clipTail("abc", 3)).toBe("abc");
  });

  it("keeps the end of plain text", () => {
    expect(clipTail("abcdef", 2)).toBe("ef");
    expect(clipTail("abcdef", 0)).toBe("");
  });

  it("drops half an emoji instead of keeping it", () => {
    expect(clipTail("ab😀cd", 3)).toBe("cd");
    expect(clipTail("ab😀cd", 4)).toBe("😀cd");
    expect(clipTail("😀😀", 3)).toBe("😀");
  });
});
