import { describe, expect, it } from "vitest";

import {
  getTopBarModes,
  isTopBarVisible,
  minimalUiBarTopPaddingPx,
} from "./top-bar";

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

describe("minimalUiBarTopPaddingPx", () => {
  it("places the widget Interact toolbar below its top bar", () => {
    expect(minimalUiBarTopPaddingPx(true)).toBe(60);
  });

  it("keeps the regular minimal toolbar's existing offset", () => {
    expect(minimalUiBarTopPaddingPx(false)).toBe(12);
  });
});

describe("getTopBarModes", () => {
  it("offers Annotate only while its lab is on", () => {
    expect(getTopBarModes({ showsModes: true, annotateLab: "on" })).toEqual([
      "interact",
      "edit",
      "annotate",
    ]);
    expect(getTopBarModes({ showsModes: true, annotateLab: "off" })).toEqual([
      "interact",
      "edit",
    ]);
  });

  it("keeps Annotate hidden until the lab answers", () => {
    expect(
      getTopBarModes({ showsModes: true, annotateLab: "loading" }),
    ).toEqual(["interact", "edit"]);
  });

  it("offers no switch when the shell does not show one", () => {
    expect(getTopBarModes({ showsModes: false, annotateLab: "on" })).toEqual(
      [],
    );
  });
});
