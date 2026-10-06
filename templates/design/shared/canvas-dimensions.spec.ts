import { describe, expect, it } from "vitest";

import { explicitCanvasDimensionsFromPrompt } from "./canvas-dimensions.js";
import {
  MAX_SANE_FRAME_ASPECT_RATIO,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "./responsive-frame-layout.js";

describe("explicitCanvasDimensionsFromPrompt", () => {
  it.each([
    ["Create an Instagram post at 1080×1080", { width: 1080, height: 1080 }],
    ["Make a 300x250 ad", { width: 300, height: 250 }],
    ["Create a screen at 1200x800", { width: 1200, height: 800 }],
    ["Use exact dimensions: 96 by 96", { width: 96, height: 96 }],
    ["Create a 1,200 x 675 pixel email banner", { width: 1200, height: 675 }],
    ["Create a 1080px × 1080px image", { width: 1080, height: 1080 }],
    ["Create a 300 pixels by 250 pixels image", { width: 300, height: 250 }],
    ["Create a 1080 px by 1080 px image", { width: 1080, height: 1080 }],
    ["Create a 2x2 card grid at 1200x800 pixels", { width: 1200, height: 800 }],
    [
      "Create a 2x2 card grid with exact canvas size 1200x800",
      { width: 1200, height: 800 },
    ],
    ["Create a 728x90 leaderboard", { width: 728, height: 90 }],
  ])("reads the requested size from %s", (prompt, dimensions) => {
    expect(explicitCanvasDimensionsFromPrompt(prompt)).toEqual(dimensions);
  });

  it("does not mistake grid counts for canvas sizes", () => {
    expect(
      explicitCanvasDimensionsFromPrompt("Create a 2x2 card grid"),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt("Create a 120x120 card grid"),
    ).toBeUndefined();
  });

  it("does not mistake an aspect ratio for pixel dimensions", () => {
    expect(explicitCanvasDimensionsFromPrompt("Create a 16x9 image")).toBe(
      undefined,
    );
    expect(
      explicitCanvasDimensionsFromPrompt("Use a 16x9 aspect ratio hero image"),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt("Use aspect ratio: 1920x1080"),
    ).toBeUndefined();
  });

  it("does not interpret physical units as pixel dimensions", () => {
    expect(
      explicitCanvasDimensionsFromPrompt("Create a 210 x 297 mm poster"),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt("Create a 210 by 297 inches poster"),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt("Create a 210 by 297 in"),
    ).toBeUndefined();
  });

  it("rejects distinct explicit canvas sizes in one prompt", () => {
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        "Create a 300x250 ad and a 728x90 leaderboard",
      ),
    ).toThrow("Use one exact canvas size per Design action call");
  });

  it("deduplicates repeated mentions of the same exact size", () => {
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Make a 300x250 ad; the canvas must be exactly 300x250 pixels",
      ),
    ).toEqual({ width: 300, height: 250 });
  });

  it("accepts exact dimensions at the editor's geometry limits", () => {
    expect(
      explicitCanvasDimensionsFromPrompt(
        `Set the exact size to ${MAX_SANE_FRAME_DIMENSION_PX}x${MAX_SANE_FRAME_DIMENSION_PX / MAX_SANE_FRAME_ASPECT_RATIO} pixels`,
      ),
    ).toEqual({
      width: MAX_SANE_FRAME_DIMENSION_PX,
      height: MAX_SANE_FRAME_DIMENSION_PX / MAX_SANE_FRAME_ASPECT_RATIO,
    });
  });

  it("rejects exact dimensions beyond the editor's maximum dimension", () => {
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        `Set the exact size to ${MAX_SANE_FRAME_DIMENSION_PX + 1}x2000 pixels`,
      ),
    ).toThrow(`limit of ${MAX_SANE_FRAME_DIMENSION_PX} px per dimension`);
  });

  it("rejects exact dimensions beyond the editor's maximum aspect ratio", () => {
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        `Set the exact size to 100000x1000 pixels`,
      ),
    ).toThrow(`limit of ${MAX_SANE_FRAME_ASPECT_RATIO}:1`);
  });
});
