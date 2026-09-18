import { describe, expect, it } from "vitest";

import {
  isImportedStaticScreenSource,
  resolveAutoFitScreenHeight,
  resolveScreenHeightMode,
} from "./screen-height";
import { readScreenSizeConstraints } from "./screen-sizing";

describe("screen height modes", () => {
  it("keeps legacy pinned and viewport-fit metadata meaningful", () => {
    expect(resolveScreenHeightMode(undefined, true)).toBe("fixed");
    expect(resolveScreenHeightMode(undefined, false)).toBe("auto");
    expect(resolveScreenHeightMode(undefined, undefined)).toBe("auto");
  });

  it("pins imported static screens unless they explicitly choose a mode", () => {
    expect(isImportedStaticScreenSource("figma-import")).toBe(true);
    expect(isImportedStaticScreenSource("html-upload")).toBe(true);
    expect(isImportedStaticScreenSource("fig-frame")).toBe(true);
    expect(isImportedStaticScreenSource("creative-context-native-clone")).toBe(
      true,
    );
    expect(isImportedStaticScreenSource("inline")).toBe(false);
    expect(resolveScreenHeightMode(undefined, false, "figma-import")).toBe(
      "fixed",
    );
    expect(resolveScreenHeightMode("hug", false, "figma-import")).toBe("hug");
    expect(resolveScreenHeightMode("auto", false, "figma-import")).toBe("auto");
  });

  it("preserves the existing device floor for automatic screens", () => {
    expect(
      resolveAutoFitScreenHeight({
        mode: "auto",
        width: 390,
        currentHeight: 84,
        measuredHeight: 84,
      }),
    ).toBe(844);
  });

  it("lets Hug shrink below both the device floor and saved frame height", () => {
    expect(
      resolveAutoFitScreenHeight({
        mode: "hug",
        width: 390,
        currentHeight: 800,
        measuredHeight: 84,
      }),
    ).toBe(84);
  });

  it("keeps a fixed screen at its saved height", () => {
    expect(
      resolveAutoFitScreenHeight({
        mode: "fixed",
        width: 390,
        currentHeight: 800,
        measuredHeight: 84,
      }),
    ).toBe(800);
  });

  it("clamps Screen frame dimensions to the authored root min/max sizes", () => {
    const sizeConstraints = readScreenSizeConstraints({
      minWidth: "200px",
      maxWidth: "400px",
      minHeight: "240px",
      maxHeight: "320px",
    });

    expect(
      resolveAutoFitScreenHeight({
        mode: "hug",
        width: 360,
        currentHeight: 400,
        measuredHeight: 500,
        sizeConstraints,
      }),
    ).toBe(320);
    expect(
      resolveAutoFitScreenHeight({
        mode: "fixed",
        width: 600,
        currentHeight: 100,
        measuredHeight: 100,
        sizeConstraints,
      }),
    ).toBe(240);
  });
});
