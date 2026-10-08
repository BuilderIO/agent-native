import { describe, expect, it } from "vitest";

import { computeCanvasFitZoom } from "./canvas-zoom";

describe("computeCanvasFitZoom", () => {
  it("keeps native zoom when the viewport can fit the slide", () => {
    expect(
      computeCanvasFitZoom({
        viewportWidth: 1280,
        canvasWidth: 960,
        horizontalPadding: 64,
      }),
    ).toBe(100);
  });

  it("shrinks a 16:9 slide to fit a mobile viewport with padding", () => {
    expect(
      computeCanvasFitZoom({
        viewportWidth: 390,
        canvasWidth: 960,
        horizontalPadding: 16,
      }),
    ).toBe(38);
  });

  it("respects the minimum zoom for extremely narrow surfaces", () => {
    expect(
      computeCanvasFitZoom({
        viewportWidth: 48,
        canvasWidth: 960,
        horizontalPadding: 16,
      }),
    ).toBe(10);
  });

  it("uses height when a short workspace would otherwise crop the slide", () => {
    expect(
      computeCanvasFitZoom({
        viewportWidth: 1280,
        viewportHeight: 360,
        canvasWidth: 960,
        canvasHeight: 540,
        horizontalPadding: 64,
        verticalPadding: 72,
      }),
    ).toBe(53);
  });

  it("scales a slide up and down to span the viewport width exactly when asked to fill it", () => {
    const fill = (viewportWidth: number) =>
      computeCanvasFitZoom({
        viewportWidth,
        viewportHeight: 900,
        canvasWidth: 960,
        canvasHeight: 540,
        fillViewport: true,
      });

    expect((960 * fill(524)) / 100).toBeCloseTo(524, 6);
    expect((960 * fill(1004)) / 100).toBeCloseTo(1004, 6);
    expect(fill(1004)).toBeGreaterThan(100);
  });

  it("still lets the height limit a filled canvas in a short pane", () => {
    expect(
      computeCanvasFitZoom({
        viewportWidth: 1200,
        viewportHeight: 270,
        canvasWidth: 960,
        canvasHeight: 540,
        fillViewport: true,
      }),
    ).toBe(50);
  });
});
