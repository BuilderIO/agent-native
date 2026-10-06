import { expect, it, vi } from "vitest";

import { memoizeByContent } from "./memoize-by-content";

it("serves a primed result without computing it, and never replaces a computed one", () => {
  const compute = vi.fn((content: string) => content.length);
  const memo = memoizeByContent(4, compute);

  memo.prime("abc", 99);
  expect(memo.has("abc")).toBe(true);
  expect(memo("abc")).toBe(99);

  expect(memo("de")).toBe(2);
  memo.prime("de", 7);
  expect(memo("de")).toBe(2);
  expect(compute).toHaveBeenCalledTimes(1);
});

it("drops the oldest results once their documents outgrow the character budget", () => {
  const memo = memoizeByContent(256, (content: string) => content.length);
  const older = "a".repeat(13_000_000);
  const newer = "b".repeat(13_000_000);

  memo(older);
  memo(newer);

  expect(memo.has(older)).toBe(false);
  expect(memo.has(newer)).toBe(true);
});
