import { describe, expect, it } from "vitest";

import {
  INTERACT_ZOOM_FIT,
  INTERACT_ZOOM_STEPS,
  formatInteractZoomLabel,
  isInteractZoomChoice,
  resolveInteractZoom,
} from "./interact-zoom";

describe("resolveInteractZoom", () => {
  it("follows the fit zoom while Fit is chosen", () => {
    expect(resolveInteractZoom(INTERACT_ZOOM_FIT, 65)).toBe(65);
    expect(resolveInteractZoom(INTERACT_ZOOM_FIT, 100)).toBe(100);
  });

  it("ignores the fit zoom once a percentage is chosen", () => {
    expect(resolveInteractZoom(150, 65)).toBe(150);
    expect(resolveInteractZoom(50, 100)).toBe(50);
  });
});

describe("INTERACT_ZOOM_STEPS", () => {
  it("offers the locked percentages in ascending order", () => {
    expect([...INTERACT_ZOOM_STEPS]).toEqual([50, 75, 100, 125, 150, 200]);
  });
});

describe("isInteractZoomChoice", () => {
  it("accepts Fit and every step", () => {
    expect(isInteractZoomChoice(INTERACT_ZOOM_FIT)).toBe(true);
    for (const step of INTERACT_ZOOM_STEPS) {
      expect(isInteractZoomChoice(step)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isInteractZoomChoice(60)).toBe(false);
    expect(isInteractZoomChoice("100")).toBe(false);
    expect(isInteractZoomChoice(null)).toBe(false);
    expect(isInteractZoomChoice(undefined)).toBe(false);
  });
});

describe("formatInteractZoomLabel", () => {
  it("reads as a whole percentage", () => {
    expect(formatInteractZoomLabel(65)).toBe("65%");
    expect(formatInteractZoomLabel(99.6)).toBe("100%");
  });

  it("reads 100% when the zoom is not a number", () => {
    expect(formatInteractZoomLabel(Number.NaN)).toBe("100%");
  });
});
