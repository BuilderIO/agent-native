import { describe, expect, it } from "vitest";

import {
  isDirectScreenHoverTarget,
  shouldShowFrameFullViewButton,
} from "./multi-screen/canvas-tools";
import {
  getChromeBorderTransition,
  getSelectionBoxTransition,
} from "./multi-screen/chrome-transitions";
import { getDraftPreviewGeometryForTool } from "./multi-screen/draft-primitives";
import { getPreviewDeviceFrameGeometry } from "./multi-screen/frame-geometry";

describe("MultiScreenCanvas selection chrome transitions", () => {
  it("does not animate selected-frame geometry during normal selection changes", () => {
    expect(getSelectionBoxTransition(false)).toBe("none");
  });

  it("settles selected-frame chrome after zoom without animating position", () => {
    const transition = getSelectionBoxTransition(true);

    expect(transition).toContain("border-width");
    expect(transition).toContain("border-radius");
    expect(transition).not.toMatch(/\b(?:inset|left|right|top|bottom)\b/);
  });

  it("keeps hover chrome free to settle its inset after zoom", () => {
    expect(getChromeBorderTransition(true)).toContain("inset");
  });

  it("treats screen content as child hover instead of direct frame hover", () => {
    const frame = { closest: () => null } as unknown as HTMLElement;
    const screenContentChild = {
      closest: (selector: string) =>
        selector === "[data-screen-content]" ? {} : null,
    } as unknown as Element;

    expect(isDirectScreenHoverTarget(frame, frame)).toBe(true);
    expect(isDirectScreenHoverTarget(screenContentChild, frame)).toBe(false);
  });

  it("keeps the Full view button visible for hovered child content", () => {
    expect(
      shouldShowFrameFullViewButton({
        emphasized: false,
        childHoverActive: true,
      }),
    ).toBe(true);
  });

  it("keeps rectangle creation preview collapsed before the drag threshold", () => {
    expect(
      getDraftPreviewGeometryForTool(
        "rect",
        { x: 50, y: 60 },
        { x: 51, y: 61 },
        false,
      ),
    ).toEqual({ x: 50, y: 60, width: 0, height: 0 });
  });

  it("uses drawn rectangle bounds after the drag threshold", () => {
    expect(
      getDraftPreviewGeometryForTool(
        "rect",
        { x: 50, y: 60 },
        { x: 54, y: 72 },
        true,
      ),
    ).toEqual({ x: 50, y: 60, width: 8, height: 12 });
  });

  it("updates both dimensions when switching to a concrete device preview", () => {
    expect(
      getPreviewDeviceFrameGeometry({
        currentGeometry: { x: 12, y: 24, width: 320, height: 640, z: 4 },
        metadata: { width: 390, height: 844 },
        previewDeviceFrame: "mobile",
      }),
    ).toEqual({ x: 12, y: 24, width: 390, height: 844, z: 4 });
  });

  it("keeps responsive preview width flexible while matching source aspect", () => {
    expect(
      getPreviewDeviceFrameGeometry({
        currentGeometry: { x: 0, y: 0, width: 640, height: 640 },
        metadata: { width: 1280, height: 800 },
        previewDeviceFrame: "none",
      }),
    ).toEqual({ x: 0, y: 0, width: 640, height: 400 });
  });
});
