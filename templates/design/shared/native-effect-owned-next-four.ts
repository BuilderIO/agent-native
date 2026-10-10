import {
  CATALOG_EDGE,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = Omit<CatalogShaderSpec, "kind"> & {
  mechanism: string;
  looks: readonly [Look, Look];
};

const fraction = (label: string, value: number): EffectProperty =>
  catalogFloat(label, value, 0, 1, 0.01);
const cssRadius = (value: number): EffectProperty => ({
  type: "float",
  label: "Neighborhood radius",
  default: value,
  min: 0,
  max: 16,
  step: 0.1,
  unit: "px",
});

export const OWNED_NEXT_FOUR_DRAFTS: readonly Draft[] = [
  {
    id: "owned-illuminant-adaptation",
    name: "Illuminant Adaptation",
    mechanism:
      "A Bradford cone-space white-point transform adapts linear source color between bounded cool and warm illuminants while retaining authored alpha.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      whiteShift: catalogFloat("White shift", 0.45, -1, 1),
      amount: fraction("Adaptation", 0.8),
    },
    helpers: () => `
fn rgbToXyz(v: vec3f) -> vec3f {
  return vec3f(dot(v, vec3f(0.4124564, 0.3575761, 0.1804375)),
    dot(v, vec3f(0.2126729, 0.7151522, 0.0721750)),
    dot(v, vec3f(0.0193339, 0.1191920, 0.9503041)));
}
fn xyzToRgb(v: vec3f) -> vec3f {
  return vec3f(dot(v, vec3f(3.2404542, -1.5371385, -0.4985314)),
    dot(v, vec3f(-0.9692660, 1.8760108, 0.0415560)),
    dot(v, vec3f(0.0556434, -0.2040259, 1.0572252)));
}
fn xyzToCone(v: vec3f) -> vec3f {
  return vec3f(dot(v, vec3f(0.8951, 0.2664, -0.1614)),
    dot(v, vec3f(-0.7502, 1.7135, 0.0367)),
    dot(v, vec3f(0.0389, -0.0685, 1.0296)));
}
fn coneToXyz(v: vec3f) -> vec3f {
  return vec3f(dot(v, vec3f(0.9869929, -0.1470543, 0.1599627)),
    dot(v, vec3f(0.4323053, 0.5183603, 0.0492912)),
    dot(v, vec3f(-0.0085287, 0.0400428, 0.9684867)));
}
`,
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let shift = ${p("whiteShift")}.x;
  let strength = ${p("amount")}.x;
  if (source.a <= 0.00001 || strength <= 0.0 || abs(shift) <= 0.00001) { return source; }
  let sourceWhite = xyzToCone(vec3f(0.95047, 1.0, 1.08883));
  let warmWhite = xyzToCone(vec3f(0.96422, 1.0, 0.82521));
  let coolWhite = xyzToCone(vec3f(0.94972, 1.0, 1.22638));
  var destinationWhite = coolWhite;
  if (shift >= 0.0) { destinationWhite = warmWhite; }
  let destinationCone = mix(sourceWhite, destinationWhite, abs(shift));
  let cone = xyzToCone(rgbToXyz(source.rgb / source.a));
  let adapted = xyzToRgb(coneToXyz(cone * destinationCone / sourceWhite));
  let straightColor = mix(source.rgb / source.a, adapted, strength);
  return vec4f(clamp(straightColor, vec3f(0.0), vec3f(1.0)) * source.a, source.a);`,
    looks: [
      ["Warm gallery", { whiteShift: 0.68, amount: 0.82 }],
      ["Cool daylight", { whiteShift: -0.72, amount: 0.9 }],
    ],
  },
  {
    id: "owned-hue-sector-relight",
    name: "Hue Sector Relight",
    mechanism:
      "A feathered angular chroma sector rotates and scales only selected linear-source hues while preserving linear luminance and coverage.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      sector: catalogFloat("Hue sector", 15, -180, 180, 1),
      width: catalogFloat("Sector width", 40, 1, 180, 1),
      feather: catalogFloat("Feather", 20, 0, 90, 1),
      rotation: catalogFloat("Hue rotation", 30, -180, 180, 1),
      chromaGain: catalogFloat("Chroma gain", 1.2, 0, 2),
      amount: fraction("Amount", 0.8),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  if (source.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return source; }
  let rgb = source.rgb / source.a;
  let y = luminance(rgb);
  let axis = vec2f(rgb.r - rgb.g, rgb.b - rgb.g);
  if (dot(axis, axis) <= 0.00000001) { return source; }
  let hue = atan2(axis.y, axis.x);
  let sector = ${p("sector")}.x * PI / 180.0;
  let distance = abs(atan2(sin(hue - sector), cos(hue - sector)));
  let halfWidth = ${p("width")}.x * PI / 360.0;
  let feather = max(${p("feather")}.x * PI / 180.0, 0.00001);
  let selected = 1.0 - smoothstep(halfWidth, halfWidth + feather, distance);
  let radians = ${p("rotation")}.x * PI / 180.0;
  let rotated = vec2f(axis.x * cos(radians) - axis.y * sin(radians),
    axis.x * sin(radians) + axis.y * cos(radians)) * ${p("chromaGain")}.x;
  let newG = y - 0.2126 * rotated.x - 0.0722 * rotated.y;
  let relit = vec3f(newG + rotated.x, newG, newG + rotated.y);
  let result = mix(rgb, relit, selected * ${p("amount")}.x);
  return vec4f(clamp(result, vec3f(0.0), vec3f(1.0)) * source.a, source.a);`,
    looks: [
      [
        "Amber isolation",
        {
          sector: -40,
          width: 28,
          feather: 18,
          rotation: 24,
          chromaGain: 1.35,
          amount: 0.7,
        },
      ],
      [
        "Blue-hour accents",
        {
          sector: 135,
          width: 55,
          feather: 24,
          rotation: -32,
          chromaGain: 0.78,
          amount: 1,
        },
      ],
    ],
  },
  {
    id: "owned-guided-local-regression",
    name: "Guided Local Regression",
    mechanism:
      "A local luminance mean and variance fit a bounded affine predictor; flat regions smooth while high-variance edges retain their source luminance and center alpha.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: cssRadius(3),
      regularization: catalogFloat("Regularization", 0.08, 0.005, 0.4),
      amount: fraction("Amount", 0.9),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001 || ${p("radius")}.x <= 0.0 || ${p("amount")}.x <= 0.0) { return center; }
  let straightColor = center.rgb / center.a;
  let centerY = luminance(straightColor);
  let stepUv = 0.5 * ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var sum = 0.0;
  var squareSum = 0.0;
  var weight = 0.0;
  for (var row = -2i; row <= 2i; row += 1i) {
    for (var column = -2i; column <= 2i; column += 1i) {
      let neighbor = sampleSource(input.uv + vec2f(f32(column), f32(row)) * stepUv);
      if (neighbor.a > 0.00001) {
        let tone = luminance(neighbor.rgb / neighbor.a);
        sum += tone * neighbor.a;
        squareSum += tone * tone * neighbor.a;
        weight += neighbor.a;
      }
    }
  }
  let mean = sum / max(weight, 0.00001);
  let variance = max(0.0, squareSum / max(weight, 0.00001) - mean * mean);
  let epsilon = ${p("regularization")}.x * ${p("regularization")}.x;
  let slope = variance / (variance + epsilon);
  let predicted = mean + slope * (centerY - mean);
  let targetY = mix(centerY, predicted, ${p("amount")}.x);
  let ratio = select(1.0, targetY / centerY, centerY > 0.00001);
  let result = clamp(straightColor * ratio, vec3f(0.0), vec3f(1.0));
  return vec4f(result * center.a, center.a);`,
    looks: [
      ["Quiet surfaces", { radius: 2, regularization: 0.12, amount: 0.72 }],
      ["Preserved contour", { radius: 7, regularization: 0.055, amount: 1 }],
    ],
  },
  {
    id: "owned-cylindrical-reprojection",
    name: "Cylindrical Reprojection",
    mechanism:
      "Inverse cylindrical geometry reprojects the authored image horizontally, with bounded yaw and vertical curvature; edge sampling remains explicit.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      arc: catalogFloat("Cylinder arc", 65, 10, 85, 1),
      yaw: catalogFloat("Yaw", 0, -35, 35, 1),
      verticalBend: catalogFloat("Vertical curvature", 0.12, 0, 0.5),
      amount: fraction("Amount", 1),
    },
    fragment: (p) => `
  if (${p("amount")}.x <= 0.0) { return sampleSource(input.uv); }
  let arc = ${p("arc")}.x * PI / 180.0;
  let yaw = ${p("yaw")}.x * PI / 180.0;
  let x = (input.uv.x - 0.5) * 2.0;
  let theta = asin(clamp(x * sin(arc), -0.99999, 0.99999));
  let projectedX = 0.5 + (theta + yaw) / (2.0 * arc);
  let bend = 1.0 - ${p("verticalBend")}.x * x * x;
  let projectedY = 0.5 + (input.uv.y - 0.5) * bend;
  let q = mix(input.uv, vec2f(projectedX, projectedY), ${p("amount")}.x);
  return sampleSource(q);`,
    looks: [
      ["Curved label", { arc: 42, yaw: 0, verticalBend: 0.08, amount: 0.75 }],
      ["Turning column", { arc: 78, yaw: 19, verticalBend: 0.28, amount: 1 }],
    ],
  },
];

export const OWNED_NEXT_FOUR_DEFINITIONS: EffectDefinition[] =
  OWNED_NEXT_FOUR_DRAFTS.map((draft) => {
    const definition = catalogShader({ ...draft, kind: "processor" });
    return {
      ...definition,
      provenance: {
        origin: "design-original",
        note: `Original Design mechanism: ${draft.mechanism}.`,
      },
    };
  });

export const OWNED_NEXT_FOUR_PRESETS: EffectPreset[] =
  OWNED_NEXT_FOUR_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index === 0 ? "subtle" : "expressive"}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: "layer" as const,
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
