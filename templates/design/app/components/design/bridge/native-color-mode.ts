export type NativeColorMode = "srgb" | "display-p3";
export type NativeDynamicRangeMode = "sdr" | "hdr";
export type NativeDynamicRangeReason =
  | "display-not-high-capable"
  | "display-capability-unreadable"
  | "float-canvas-unavailable"
  | "extended-tone-mapping-unavailable"
  | "gpu-unavailable";

type NativeColorCapabilityBase = {
  requested: NativeColorMode;
  presented: NativeColorMode;
  sourceGamut: "dom-srgb-only";
  displayDynamicRangeCapability:
    | "high-capable"
    | "standard-only"
    | "unreadable";
  canvasToneMappingStandard: "observed" | "member-not-observed" | "unreadable";
  reason?: "p3-canvas-unavailable" | "gpu-unavailable";
};

export type NativeColorCapability = NativeColorCapabilityBase &
  (
    | {
        hdr: "unavailable";
        outputDynamicRange: "sdr";
        requestedDynamicRange?: undefined;
        presentedDynamicRange?: undefined;
        dynamicRangeReason?: undefined;
      }
    | {
        hdr: "unavailable";
        outputDynamicRange: "sdr";
        requestedDynamicRange: "sdr";
        presentedDynamicRange: "sdr";
        dynamicRangeReason?: undefined;
      }
    | {
        hdr: "unavailable";
        outputDynamicRange: "sdr";
        requestedDynamicRange: "hdr";
        presentedDynamicRange: "sdr";
        dynamicRangeReason: NativeDynamicRangeReason;
      }
    | {
        hdr: "configured";
        outputDynamicRange: "hdr";
        requestedDynamicRange: "hdr";
        presentedDynamicRange: "hdr";
        dynamicRangeReason?: undefined;
      }
  );

export function detectNativeDisplayDynamicRange(
  query: ((media: string) => boolean) | undefined,
): NativeColorCapability["displayDynamicRangeCapability"] {
  if (!query) return "unreadable";
  try {
    if (query("(dynamic-range: high)")) return "high-capable";
    return query("(dynamic-range: standard)") ? "standard-only" : "unreadable";
  } catch {
    return "unreadable";
  }
}

export const LINEAR_SRGB_TO_DISPLAY_P3 = [
  [0.8224620105651395, 0.17753798943486054, 0],
  [0.03319415910219203, 0.966805840897808, 0],
  [0.01708266272173309, 0.0723974914511293, 0.9105198458271376],
] as const;

export function linearSrgbToDisplayP3(
  rgb: readonly [number, number, number],
): [number, number, number] {
  return LINEAR_SRGB_TO_DISPLAY_P3.map(
    (row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2],
  ) as [number, number, number];
}

export function encodeDisplayP3(linear: number): number {
  return linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

export function usesDisplayP3Color(
  definition: EffectDefinition,
  params: EffectInstance["params"],
): boolean {
  return Object.entries(definition.properties).some(([name, property]) => {
    if (property.type !== "color" && property.type !== "color-array")
      return false;
    const value = Object.prototype.hasOwnProperty.call(params, name)
      ? params[name]
      : property.default;
    if (property.type === "color")
      return (
        !!value &&
        !Array.isArray(value) &&
        typeof value === "object" &&
        "space" in value &&
        value.space === "display-p3"
      );
    return (
      Array.isArray(value) &&
      value.some(
        (color) =>
          !!color &&
          typeof color === "object" &&
          "space" in color &&
          color.space === "display-p3",
      )
    );
  });
}

export function hasFloatColorPath(definition: EffectDefinition): boolean {
  return definition.passes.every((pass) => {
    if (pass.kind !== "render") return false;
    const output = definition.resources?.find(
      (resource) => resource.name === pass.output,
    );
    return output?.kind === "texture-2d" && output.format === "rgba16float";
  });
}

const p3 = LINEAR_SRGB_TO_DISPLAY_P3;
export const LINEAR_SRGB_TO_DISPLAY_P3_WGSL = `
fn linearSrgbToDisplayP3(rgb: vec3f) -> vec3f {
  return vec3f(
    dot(rgb, vec3f(${p3[0].join(", ")})),
    dot(rgb, vec3f(${p3[1].join(", ")})),
    dot(rgb, vec3f(${p3[2].join(", ")}))
  );
}`;
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
