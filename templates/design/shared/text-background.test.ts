import { describe, expect, it } from "vitest";

import {
  readPaintLayers,
  resolveTextBackground,
  type PaintLayer,
} from "./text-background";

const layer = (overrides: Partial<PaintLayer> = {}): PaintLayer => ({
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  opacity: "1",
  mixBlendMode: "normal",
  ...overrides,
});

describe("resolveTextBackground", () => {
  it("is the nearest opaque ancestor's color", () => {
    expect(
      resolveTextBackground([
        layer(),
        layer({ backgroundColor: "rgb(17, 24, 39)" }),
        layer({ backgroundColor: "rgb(255, 255, 255)" }),
      ]),
    ).toEqual({ kind: "ready", color: { r: 17, g: 24, b: 39 } });
  });

  it("uses the text element's own background when it has one", () => {
    expect(
      resolveTextBackground([
        layer({ backgroundColor: "rgb(0, 0, 255)" }),
        layer({ backgroundColor: "rgb(255, 255, 255)" }),
      ]),
    ).toEqual({ kind: "ready", color: { r: 0, g: 0, b: 255 } });
  });

  it("paints a translucent background over the opaque one behind it", () => {
    expect(
      resolveTextBackground([
        layer({ backgroundColor: "rgba(0, 0, 0, 0.5)" }),
        layer({ backgroundColor: "rgb(255, 255, 255)" }),
      ]),
    ).toEqual({ kind: "ready", color: { r: 127.5, g: 127.5, b: 127.5 } });
  });

  it("stacks several translucent backgrounds in paint order", () => {
    const resolved = resolveTextBackground([
      layer({ backgroundColor: "rgba(255, 0, 0, 0.5)" }),
      layer({ backgroundColor: "rgba(0, 0, 255, 0.5)" }),
      layer({ backgroundColor: "rgb(255, 255, 255)" }),
    ]);
    // Blue over white, then red over that.
    expect(resolved).toEqual({
      kind: "ready",
      color: { r: 255 * 0.5 + 127.5 * 0.5, g: 63.75, b: 255 * 0.5 + 0 },
    });
  });

  it("reads a modern color syntax by its sRGB fallback", () => {
    const resolved = resolveTextBackground([
      layer({ backgroundColor: "color(srgb 1 0 0)" }),
    ]);
    expect(resolved).toEqual({ kind: "ready", color: { r: 255, g: 0, b: 0 } });
  });

  it("ignores what is behind an opaque ancestor", () => {
    expect(
      resolveTextBackground([
        layer({ backgroundColor: "rgb(10, 20, 30)" }),
        layer({ backgroundImage: "linear-gradient(red, blue)" }),
      ]),
    ).toEqual({ kind: "ready", color: { r: 10, g: 20, b: 30 } });
  });

  it("is unavailable, not white, when nothing behind the text is opaque", () => {
    expect(resolveTextBackground([layer(), layer(), layer()])).toEqual({
      kind: "unavailable",
      reason: "no-opaque-background",
    });
    expect(
      resolveTextBackground([
        layer({ backgroundColor: "rgba(0, 0, 0, 0.3)" }),
        layer(),
      ]),
    ).toEqual({ kind: "unavailable", reason: "no-opaque-background" });
  });

  it("is unavailable for a gradient or image behind the text", () => {
    expect(
      resolveTextBackground([
        layer(),
        layer({
          backgroundColor: "rgb(255, 255, 255)",
          backgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))",
        }),
      ]),
    ).toEqual({ kind: "unavailable", reason: "image" });
    expect(
      resolveTextBackground([layer({ backgroundImage: 'url("a.png")' })]),
    ).toEqual({ kind: "unavailable", reason: "image" });
  });

  it("is unavailable when opacity or blending changes what the text sits on", () => {
    expect(
      resolveTextBackground([
        layer({ opacity: "0.6" }),
        layer({ backgroundColor: "rgb(255, 255, 255)" }),
      ]),
    ).toEqual({ kind: "unavailable", reason: "blending" });
    expect(
      resolveTextBackground([
        layer(),
        layer({
          backgroundColor: "rgb(255, 255, 255)",
          mixBlendMode: "multiply",
        }),
      ]),
    ).toEqual({ kind: "unavailable", reason: "blending" });
    expect(resolveTextBackground([layer({ opacity: "not a number" })])).toEqual(
      { kind: "unavailable", reason: "blending" },
    );
  });

  it("is unavailable for a background color it cannot read", () => {
    expect(
      resolveTextBackground([layer({ backgroundColor: "mystery-color" })]),
    ).toEqual({ kind: "unavailable", reason: "unreadable-color" });
  });

  it("is unavailable for an empty chain", () => {
    expect(resolveTextBackground([])).toEqual({
      kind: "unavailable",
      reason: "no-opaque-background",
    });
  });
});

describe("readPaintLayers", () => {
  it("accepts the bridge's list of layers", () => {
    const layers = [layer(), layer({ backgroundColor: "rgb(1, 2, 3)" })];
    expect(readPaintLayers(layers)).toEqual(layers);
  });

  it("rejects anything else, so a bad reply is never read as a background", () => {
    expect(readPaintLayers(null)).toBeNull();
    expect(readPaintLayers(undefined)).toBeNull();
    expect(readPaintLayers([])).toBeNull();
    expect(readPaintLayers({ backgroundColor: "red" })).toBeNull();
    expect(readPaintLayers([{ backgroundColor: "red" }])).toBeNull();
    expect(readPaintLayers([layer(), 5])).toBeNull();
  });
});
