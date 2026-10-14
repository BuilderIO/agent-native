import { expect, it } from "vitest";

import { samePlainData } from "./editor-helpers";

it("compares plain data by value, treating undefined fields as missing", () => {
  expect(
    samePlainData(
      { rect: { x: 1, y: 2 }, styles: { color: "red" }, parent: undefined },
      { rect: { x: 1, y: 2 }, styles: { color: "red" } },
    ),
  ).toBe(true);
  expect(samePlainData({ rect: { x: 1 } }, { rect: { x: 2 } })).toBe(false);
  expect(samePlainData({ tags: ["a", "b"] }, { tags: ["a"] })).toBe(false);
  expect(samePlainData({ tags: [] }, { tags: {} })).toBe(false);
  expect(samePlainData(null, {})).toBe(false);
});
