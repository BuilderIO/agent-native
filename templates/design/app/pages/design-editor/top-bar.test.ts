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

  it("keeps the real top bar visible in a minimal MCP widget", () => {
    expect(
      isTopBarVisible({
        embedded: true,
        isVisualEditSurface: false,
        minimalUi: true,
        uiHidden: false,
        widgetEmbed: true,
      }),
    ).toBe(true);
  });

  it("respects the explicit hidden state in a widget", () => {
    expect(
      isTopBarVisible({ ...docked, widgetEmbed: true, uiHidden: true }),
    ).toBe(false);
  });
});
