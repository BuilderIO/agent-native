import {
  isNativePositionValue,
  resolveNativePosition,
} from "@shared/native-effect-position";
import { describe, expect, it } from "vitest";

import {
  NATIVE_POSITION_ANCHORS,
  nativePositionAnchor,
  nativePositionAxisDisplay,
  updateNativePositionAxis,
  changeNativePositionUnit,
} from "./native-position-controls";

describe("native position controls", () => {
  it("preserves the untouched axis when editing a keyword or dimensional coordinate", () => {
    expect(
      updateNativePositionAxis("right top", "x", {
        value: 25,
        unit: "percent",
      }),
    ).toEqual({ x: { value: 25, unit: "percent" }, y: 0 });
    expect(
      updateNativePositionAxis({ x: 0.5, y: "bottom" }, "x", {
        value: 60,
        unit: "px",
      }),
    ).toEqual({ x: { value: 60, unit: "px" }, y: "bottom" });
  });
  it("round-trips ratio and percent without changing an unrelated pixel axis", () => {
    const value = { x: 0.333333333, y: { value: 24, unit: "px" as const } };
    const percent = changeNativePositionUnit(value, "x", "percent");
    expect(nativePositionAxisDisplay(percent, "x")).toEqual({
      value: 33.3333333,
      unit: "percent",
    });
    expect(changeNativePositionUnit(percent, "x", "uv")).toEqual({
      x: { value: 0.333333333, unit: "uv" },
      y: value.y,
    });
    const geometry = {
      source: { width: 240, height: 120 },
      viewport: { width: 400, height: 300 },
      pixelRatio: 2,
    };
    expect(resolveNativePosition(percent, "source", geometry)).toEqual(
      resolveNativePosition(value, "source", geometry),
    );
  });
  it("offers valid named anchors and keeps dimensional custom positions distinct", () => {
    expect(NATIVE_POSITION_ANCHORS).toHaveLength(9);
    for (const anchor of NATIVE_POSITION_ANCHORS) {
      expect(isNativePositionValue(anchor.value)).toBe(true);
      expect(nativePositionAnchor(anchor.value)).toBe(anchor.value);
      expect(nativePositionAxisDisplay(anchor.value, "x").value).toBe(anchor.x);
      expect(nativePositionAxisDisplay(anchor.value, "y").value).toBe(anchor.y);
    }
    expect(
      nativePositionAnchor({ x: { value: 50, unit: "percent" }, y: 0.5 }),
    ).toBe("center");
    expect(nativePositionAnchor({ x: { value: 1, unit: "px" }, y: 0.5 })).toBe(
      "custom",
    );
  });
  it("rejects invalid edits instead of coercing them to a valid-looking center", () => {
    expect(() =>
      updateNativePositionAxis("center", "x", { value: NaN, unit: "px" }),
    ).toThrow();
    expect(() =>
      updateNativePositionAxis("center", "y", { value: 1_000_001, unit: "uv" }),
    ).toThrow();
  });
});
