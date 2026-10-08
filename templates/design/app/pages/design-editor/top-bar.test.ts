import { describe, expect, it } from "vitest";

import { isTopBarVisible } from "./top-bar";

const docked = {
  embedded: false,
  isVisualEditSurface: false,
  minimalUi: false,
  uiHidden: false,
};

describe("isTopBarVisible", () => {
  it("renders on the docked editor", () => {
    expect(isTopBarVisible(docked)).toBe(true);
  });

  it.each([
    ["embedded", { embedded: true }],
    ["the visual-edit route", { isVisualEditSurface: true }],
    ["minimal UI", { minimalUi: true }],
    ["hidden UI", { uiHidden: true }],
  ])("is absent in %s", (_name, override) => {
    expect(isTopBarVisible({ ...docked, ...override })).toBe(false);
  });
});
