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
    ["Create a screen, 1200x800", { width: 1200, height: 800 }],
    ["Use exact dimensions: 96 by 96", { width: 96, height: 96 }],
    ["Create a 1,200 x 675 pixel email banner", { width: 1200, height: 675 }],
    ["Create an email header at 1200x400", { width: 1200, height: 400 }],
    ["Create an Instagram post: 1080x1080", { width: 1080, height: 1080 }],
    ["Make a banner, 728x90", { width: 728, height: 90 }],
    ["Create an image at 1080x1080", { width: 1080, height: 1080 }],
    ["Create an image of 1200x800", { width: 1200, height: 800 }],
    ["Make an image 1200x800", { width: 1200, height: 800 }],
    ["Create a 1080x1080 image", { width: 1080, height: 1080 }],
    ["Create a screen at 1080px × 1080px", { width: 1080, height: 1080 }],
    [
      "Create a 300 pixels by 250 pixels email banner",
      { width: 300, height: 250 },
    ],
    ["Create a screen at 1080 px by 1080 px", { width: 1080, height: 1080 }],
    ["Create a 1080px × 1080px image", { width: 1080, height: 1080 }],
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

  it("requires context that identifies dimensions as the output canvas size", () => {
    expect(
      explicitCanvasDimensionsFromPrompt("Make a desktop 1440x900 dashboard"),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a responsive page with desktop 1440x900 and mobile 390x844",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 16px × 16px notification icon",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a screen with an image at 300x250",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with image 300x250",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a responsive landing page with a hero image at 1200x600 pixels",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a responsive landing page using a 1200x800 hero image",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a responsive landing page for a 1200x800 hero image",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a dashboard with image dimensions exactly 300x250",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a responsive landing page with exact dimensions 1200x800 hero image",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a responsive landing page using exact canvas size 1200x800 with a hero image",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a dashboard featuring a large 300x250 ad",
      ),
    ).toBeUndefined();
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a website with a 300x250 hero image and a 728x90 banner",
      ),
    ).toBeUndefined();
  });

  it("prefers explicit screen dimensions over nested asset dimensions", () => {
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with a 300x250 ad",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen for a 300x250 hero image",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with a 300x250px image",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with image dimensions 300x250",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with a hero image of dimensions 300x250",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 300x250 hero image for a screen at 1200x800",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a screen at 1200x800 with image dimensions 300x250",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with a 1,000,000x1000px image",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 canvas with a 300x250 ad",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen with a 300x250 ad and a 728x90 banner",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen, add an image at 300x250",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen: Add an image at 300x250",
      ),
    ).toEqual({ width: 1200, height: 800 });
  });

  it("prefers output-format dimensions over nested image dimensions", () => {
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 300x250 ad with a 1080px × 1080px image",
      ),
    ).toEqual({ width: 300, height: 250 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create an Instagram post at 1080x1080 with a 300x250px image",
      ),
    ).toEqual({ width: 1080, height: 1080 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 300x250 ad that includes a 1080x1080 image",
      ),
    ).toEqual({ width: 300, height: 250 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 screen for a dashboard. Add a 300x250px hero image",
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 300x250 ad with the image exactly 1080x1080",
      ),
    ).toEqual({ width: 300, height: 250 });
    expect(
      explicitCanvasDimensionsFromPrompt(
        "Create a 300x250 ad and include a 1080x1080 image",
      ),
    ).toEqual({ width: 300, height: 250 });
  });

  it("rejects invalid dimensions when they describe the requested output", () => {
    expect(() =>
      explicitCanvasDimensionsFromPrompt("Create an image at 100001x2000"),
    ).toThrow(`limit of ${MAX_SANE_FRAME_DIMENSION_PX} px per dimension`);
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
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        "Create a 1200x800 canvas and a 300x250 ad",
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
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        "Set the exact size to 1000000000000x1000 pixels",
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

  it("rejects non-positive exact dimensions instead of ignoring them", () => {
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        "Create an image exactly 0x600 pixels",
      ),
    ).toThrow("must be greater than zero");
    expect(() =>
      explicitCanvasDimensionsFromPrompt(
        "Create an image exactly -300x250 pixels",
      ),
    ).toThrow("must be greater than zero");
  });
});
