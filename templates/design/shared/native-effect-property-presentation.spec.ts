import { describe, expect, it } from "vitest";

import {
  NATIVE_EFFECT_BUILTIN_VERSIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_DEFINITION_CATALOG,
} from "./native-effect-presets";
import {
  getNativeEffectPropertyPresentation,
  getNativeEffectPropertyPresentations,
  NATIVE_EFFECT_PROPERTY_PRESENTATIONS,
  NATIVE_OPACITY_PRESENTATION,
  NATIVE_SPEED_PRESENTATION,
  nativeEffectValueFromDisplay,
  nativeEffectValueToDisplay,
} from "./native-effect-property-presentation";
import { nativeEffectExecutionPayload } from "./native-effect-trust";
import { packNativeProperties } from "./native-effects";

function definition(id: string, version?: number) {
  const result = NATIVE_EFFECT_BUILTIN_VERSIONS.find(
    (candidate) =>
      candidate.id === `an-native-${id}` &&
      (version === undefined || candidate.version === version),
  );
  if (!result) throw new Error(`Missing test definition ${id}@${version}`);
  return result;
}

describe("native effect display units", () => {
  it("reviews every numeric property of the current shader catalog and compatible versions", () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toEqual(
      NATIVE_EFFECT_DEFINITION_CATALOG,
    );
    expect(Object.keys(NATIVE_EFFECT_PROPERTY_PRESENTATIONS).sort()).toEqual(
      NATIVE_EFFECT_BUILTIN_VERSIONS.map(
        ({ id, version }) => `${id}@${version}`,
      ).sort(),
    );
    for (const item of NATIVE_EFFECT_BUILTIN_VERSIONS) {
      const numericKeys = Object.entries(item.properties)
        .filter(([, property]) =>
          ["float", "int", "vec2"].includes(property.type),
        )
        .map(([key]) => key)
        .sort();
      expect(
        Object.keys(
          NATIVE_EFFECT_PROPERTY_PRESENTATIONS[`${item.id}@${item.version}`]!,
        ).sort(),
      ).toEqual(numericKeys);
      expect(
        Object.keys(getNativeEffectPropertyPresentations(item)).sort(),
      ).toEqual(numericKeys);
    }
  });

  it.each([
    ["liquid-metal", 12, "scale", 1, 100, "%"],
    ["liquid-metal", 12, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 12, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 12, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 11, "scale", 1, 100, "%"],
    ["liquid-metal", 11, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 11, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 11, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 10, "scale", 1, 100, "%"],
    ["liquid-metal", 10, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 10, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 10, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 9, "scale", 1, 100, "%"],
    ["liquid-metal", 9, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 9, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 9, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 8, "scale", 1, 100, "%"],
    ["liquid-metal", 8, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 8, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 8, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 7, "scale", 1, 100, "%"],
    ["liquid-metal", 7, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 7, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 7, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 6, "scale", 1, 100, "%"],
    ["liquid-metal", 6, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 6, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 6, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 5, "scale", 1, 100, "%"],
    ["liquid-metal", 5, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 5, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 5, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 4, "scale", 1, 100, "%"],
    ["liquid-metal", 4, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 4, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 4, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 3, "scale", 1, 100, "%"],
    ["liquid-metal", 3, "repetition", 1.5, 150, "%"],
    ["liquid-metal", 3, "contour", 0.4, 40, "%"],
    ["liquid-metal", 3, "distortion", 0.1, 10, "%"],
    ["liquid-metal", 3, "softness", 0.05, 5, "%"],
    ["liquid-metal", 3, "angle", Math.PI / 2, 90, "°"],
    ["liquid-metal", 3, "shiftRed", 0.3, 30, "%"],
    ["liquid-metal", 3, "shiftBlue", -0.3, -30, "%"],
    ["liquid-metal", 2, "scale", 1, 100, "%"],
    ["liquid-metal", 2, "distortion", 0.8, 80, "%"],
    ["liquid-metal", 2, "roughness", 0.04, 4, "%"],
    ["liquid-metal", 2, "lightAngle", Math.PI / 4, 45, "°"],
    ["liquid-metal", 1, "scale", 2, 200, "%"],
    ["waves", 1, "amplitude", 0.22, 22, "%"],
    ["waves", 1, "frequency", 1.5, 1.5, "×"],
    ["sobel-edges", 1, "strength", 2, 2, "×"],
    ["sobel-edges", 1, "radius", 1, 1, "px"],
    ["frosted-refraction", 3, "distortion", 7, 7, "px"],
    ["fluted-glass", 1, "fluteWidth", 24, 24, "px"],
    ["liquid-glass", 1, "thickness", 12, 12, "px"],
    ["liquid-glass", 1, "edgeWidth", 24, 24, "px"],
    ["liquid-glass", 1, "frost", 0.5, 0.5, "px"],
    ["liquid-glass", 1, "highlight", 0.5, 50, "%"],
    ["liquid-glass", 1, "lightAngle", Math.PI * 1.25, 225, "°"],
    ["liquid-glass", 2, "thickness", 12, 12, "px"],
    ["liquid-glass", 2, "edgeWidth", 24, 24, "px"],
    ["liquid-glass", 2, "frost", 0.5, 0.5, "px"],
    ["liquid-glass", 2, "highlight", 0.5, 50, "%"],
    ["liquid-glass", 2, "lightAngle", Math.PI * 1.25, 225, "°"],
    ["liquid-glass", 3, "thickness", 28, 28, "px"],
    ["liquid-glass", 3, "edgeWidth", 36, 36, "px"],
    ["liquid-glass", 3, "frost", 0.5, 0.5, "px"],
    ["liquid-glass", 3, "highlight", 0.5, 50, "%"],
    ["liquid-glass", 3, "lightAngle", Math.PI * 1.25, 225, "°"],
    ["owned-cc-source-glints", 1, "rayLength", 10, 10, "px"],
    ["color-grade", 2, "exposure", 0.25, 0.25, "EV"],
    ["color-grade", 2, "warmth", -0.5, -50, "%"],
    ["color-grade", 2, "brightness", -0.2, -20, "%"],
    ["posterize", 1, "levels", 5, 5, ""],
    ["mesh-anchors", 5, "detail", 4, 4, ""],
    ["grain-gradient", 3, "grain", 0.065, 6.5, "%"],
  ] as const)(
    "%s@%s %s uses its semantic unit",
    (id, version, key, raw, display, unit) => {
      const item = definition(id, version);
      const presentation = getNativeEffectPropertyPresentation(item, key)!;
      expect(presentation.unit).toBe(unit);
      expect(nativeEffectValueToDisplay(raw, presentation)).toBeCloseTo(
        display,
        10,
      );
      expect(nativeEffectValueFromDisplay(display, presentation)).toBeCloseTo(
        raw,
        10,
      );
    },
  );

  it("converts default/min/max metadata without modifying executable properties or packed values", () => {
    for (const item of NATIVE_EFFECT_BUILTIN_VERSIONS) {
      const payload = JSON.stringify(nativeEffectExecutionPayload(item));
      const packed = packNativeProperties(item);
      const metadata = getNativeEffectPropertyPresentations(item);
      for (const [key, display] of Object.entries(metadata)) {
        const property = item.properties[key]!;
        if (property.type !== "float" && property.type !== "int")
          throw new Error("Unexpected builtin numeric property");
        expect(display.default).toBeCloseTo(
          property.default * display.displayScale,
          10,
        );
        expect(display.min).toBeCloseTo(
          property.min! * display.displayScale,
          10,
        );
        expect(display.max).toBeCloseTo(
          property.max! * display.displayScale,
          10,
        );
        for (const raw of [property.default, property.min!, property.max!])
          expect(
            nativeEffectValueFromDisplay(
              nativeEffectValueToDisplay(raw, display),
              display,
            ),
          ).toBeCloseTo(raw, 10);
      }
      expect(JSON.stringify(nativeEffectExecutionPayload(item))).toBe(payload);
      expect(packNativeProperties(item)).toEqual(packed);
    }
  });

  it("keeps fractional softness, spatial radii, and frequency defaults on their slider grids", () => {
    for (const [id, version, key] of [
      ["sobel-edges", 1, "radius"],
      ["waves", 1, "frequency"],
      ["waves", 1, "softness"],
      ["mesh-anchors", 5, "softness"],
      ["gradient-field", 1, "softness"],
      ["hex-tiles", 1, "softness"],
    ] as const) {
      const display = getNativeEffectPropertyPresentations(
        definition(id, version),
      )[key]!;
      const increments =
        (Number(display.default) - display.min!) / display.step;
      expect(increments).toBeCloseTo(Math.round(increments), 8);
    }
  });

  it("leaves custom parameter units explicit and never guesses from familiar property names", () => {
    const custom = {
      ...definition("waves"),
      id: "user-authored-field",
      properties: {
        scale: {
          type: "float" as const,
          label: "Scale",
          default: 2,
          step: 0.02,
          displayScale: 10,
          unit: "cm",
        },
        amplitude: { type: "float" as const, label: "Amplitude", default: 0.4 },
        rotation: {
          type: "vec2" as const,
          label: "Rotation",
          default: [1, 2] as [number, number],
          min: 0,
          max: 3,
          step: 0.1,
          displayScale: 2,
          unit: "turn",
        },
      },
    };
    expect(getNativeEffectPropertyPresentations(custom)).toEqual({
      scale: { displayScale: 10, unit: "cm", step: 0.2, default: 20 },
      amplitude: { displayScale: 1, unit: "", step: 0.01, default: 0.4 },
      rotation: {
        displayScale: 2,
        unit: "turn",
        step: 0.2,
        default: [2, 4],
        min: 0,
        max: 6,
      },
    });
    expect(
      getNativeEffectPropertyPresentation(definition("waves"), "palette"),
    ).toBeNull();
    expect(getNativeEffectPropertyPresentation(custom, "missing")).toBeNull();
  });

  it("uses 100 percent for normal global opacity and playback speed", () => {
    for (const presentation of [
      NATIVE_OPACITY_PRESENTATION,
      NATIVE_SPEED_PRESENTATION,
    ]) {
      expect(presentation).toEqual({ displayScale: 100, unit: "%", step: 1 });
      expect(nativeEffectValueToDisplay(1, presentation)).toBe(100);
      expect(nativeEffectValueFromDisplay(150, presentation)).toBe(1.5);
    }
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite values %s",
    (value) => {
      expect(() =>
        nativeEffectValueToDisplay(value, NATIVE_OPACITY_PRESENTATION),
      ).toThrow(RangeError);
      expect(() =>
        nativeEffectValueFromDisplay(value, NATIVE_OPACITY_PRESENTATION),
      ).toThrow(RangeError);
    },
  );
});
