import { rgbaToLinearSrgb } from "@shared/color-spaces";
import { describe, expect, it } from "vitest";

import {
  computeContrastMap,
  readContrast,
} from "./color-picker-contrast-model";

const gray = (value: number) =>
  rgbaToLinearSrgb({ r: value, g: value, b: value, a: 1 });
const white = { kind: "ready", color: { r: 255, g: 255, b: 255 } } as const;

describe("readContrast", () => {
  it("is the ratio, its level and the targets for the text size", () => {
    const reading = readContrast({
      large: false,
      background: white,
      linear: gray(0x76),
      alpha: 1,
    });
    expect(reading).toMatchObject({
      kind: "ready",
      level: "AA",
      large: false,
      targets: { aa: 4.5, aaa: 7 },
      background: { r: 255, g: 255, b: 255 },
    });
    expect(reading.kind === "ready" && reading.ratio).toBeCloseTo(4.542, 3);
  });

  it("misses AA at #777777 on white, and uses the large-text bar for large text", () => {
    const body = readContrast({
      large: false,
      background: white,
      linear: gray(0x77),
      alpha: 1,
    });
    expect(body).toMatchObject({ kind: "ready", level: null });
    const large = readContrast({
      large: true,
      background: white,
      linear: gray(0x77),
      alpha: 1,
    });
    expect(large).toMatchObject({
      kind: "ready",
      level: "AA",
      targets: { aa: 3, aaa: 4.5 },
    });
  });

  it("reaches AAA", () => {
    expect(
      readContrast({
        large: false,
        background: white,
        linear: gray(0),
        alpha: 1,
      }),
    ).toMatchObject({ kind: "ready", level: "AAA" });
  });

  it("counts the text's opacity against the ratio", () => {
    const opaque = readContrast({
      large: false,
      background: white,
      linear: gray(0),
      alpha: 1,
    });
    const faint = readContrast({
      large: false,
      background: white,
      linear: gray(0),
      alpha: 0.3,
    });
    expect(opaque.kind === "ready" && faint.kind === "ready").toBe(true);
    if (opaque.kind === "ready" && faint.kind === "ready") {
      expect(faint.ratio).toBeLessThan(opaque.ratio);
      expect(faint.level).toBeNull();
    }
  });

  it("is loading until the background has been read", () => {
    expect(
      readContrast({
        large: false,
        background: null,
        linear: gray(0),
        alpha: 1,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("is unavailable, with the reason, when there is no background to read", () => {
    expect(
      readContrast({
        large: false,
        background: { kind: "unavailable", reason: "image" },
        linear: gray(0),
        alpha: 1,
      }),
    ).toEqual({ kind: "unavailable", reason: "image" });
  });

  it("is unavailable, never a ratio, when the text size is unknown", () => {
    expect(
      readContrast({
        large: null,
        background: white,
        linear: gray(0),
        alpha: 1,
      }),
    ).toEqual({ kind: "unavailable", reason: "text-size" });
  });
});

describe("computeContrastMap", () => {
  it("draws one line where a whole side of the square misses the target", () => {
    const map = computeContrastMap((_s, v) => v > 0.5);
    expect(map.lines).toHaveLength(1);
    const [line] = map.lines;
    expect(line).toHaveLength(40);
    for (const point of line!) expect(point.v).toBeCloseTo(0.5, 1);
    expect(map.bands).toHaveLength(1);
    for (const band of map.bands[0]!) {
      expect(band.lo).toBeCloseTo(0.5, 1);
      expect(band.hi).toBe(1);
    }
  });

  it("draws two lines around a band that misses in the middle", () => {
    const map = computeContrastMap((_s, v) => v > 0.3 && v < 0.7);
    expect(map.lines).toHaveLength(2);
    const values = map.lines.map((line) => line[0]!.v).sort();
    expect(values[0]).toBeCloseTo(0.3, 1);
    expect(values[1]).toBeCloseTo(0.7, 1);
  });

  it("follows a line that bends with saturation", () => {
    const map = computeContrastMap((s, v) => v > 0.9 - s * 0.6);
    const [line] = map.lines;
    expect(line![0]!.v).toBeCloseTo(0.9, 1);
    expect(line![line!.length - 1]!.v).toBeCloseTo(0.3, 1);
  });

  it("has no lines and no dots when every color meets the target", () => {
    expect(computeContrastMap(() => false)).toEqual({ bands: [], lines: [] });
  });

  it("dots everything and draws no line when no color meets it", () => {
    const map = computeContrastMap(() => true);
    expect(map.lines).toEqual([]);
    expect(map.bands).toHaveLength(1);
    for (const band of map.bands[0]!) {
      expect(band.lo).toBe(0);
      expect(band.hi).toBe(1);
    }
  });

  it("breaks the line where a column has nothing missing", () => {
    // Columns with s in (0.4, 0.6) all meet the target; the rest miss above 0.5.
    const map = computeContrastMap((s, v) =>
      s > 0.4 && s < 0.6 ? false : v > 0.5,
    );
    expect(map.lines).toHaveLength(2);
    expect(map.bands).toHaveLength(2);
  });
});
