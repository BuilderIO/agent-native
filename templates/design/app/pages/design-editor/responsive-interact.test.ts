import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeInteractZoomToFit } from "./responsive-interact";

describe("computeInteractZoomToFit", () => {
  it("keeps 100% when the device already fits the available space", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 1200,
        availableHeight: 1200,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });

  it("steps down to the nearest 5 when width is the constraint", () => {
    // widthScale = 500/402 ≈ 1.24 (fits); heightScale = 400/874 ≈ 0.4577 →
    // 45.77% → floored to 45.
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 400,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("uses the smaller of width/height scale", () => {
    // widthScale = 200/402 ≈ 0.4975 → 49.75%; heightScale = 900/874 ≈ 1.03
    // (fits) — the tighter width constraint wins, floored to 45.
    expect(
      computeInteractZoomToFit({
        availableWidth: 200,
        availableHeight: 900,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("clamps to minZoom instead of going below it", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 50,
        availableHeight: 50,
        deviceWidth: 1440,
        deviceHeight: 900,
        minZoom: 10,
      }),
    ).toBe(10);
  });

  it("falls back to 100 for a degenerate device size", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 500,
        deviceWidth: 0,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });
});

// The bar is only worth building if it is actually mounted and the editor
// chrome steps aside for it — a component that renders nowhere was the
// original gap here. Source assertions match this file tree's existing
// wiring-guard convention (see DesignEditor.breakpoints.test.ts).
describe("full-screen Interact wiring", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("activates only for a focused screen outside embedded hosts", () => {
    expect(source).toContain("const responsiveInteractActive =");
    expect(source).toContain(
      'mode === "interact" && viewMode === "single" && !!activeFile && !embedded',
    );
  });

  it("mounts the bar and hides both side rails while active", () => {
    expect(source).toContain("<ResponsiveInteractBar");
    expect(source).toContain("onClose={handleExitResponsiveInteract}");
    // Left rail, then right rail — both gated off while Interact is active.
    expect(source).toContain(
      "!embedded && !uiHidden && !responsiveInteractActive",
    );
    expect(source).toContain("!responsiveInteractActive ? (");
  });

  it("drives the canvas from the device box rather than the canvas camera", () => {
    expect(source).toContain("responsiveInteractActive ? interactZoom : zoom");
    expect(source).toContain(
      "responsiveInteractActive ? setInteractZoom : setZoom",
    );
    expect(source).toContain("? interactDeviceSize.width");
  });
});
