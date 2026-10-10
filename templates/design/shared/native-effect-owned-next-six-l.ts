import {
  catalogColor,
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
  maxSamples: number;
};

const distance = (
  label: string,
  value: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const amount = (label: string, value: number, max = 1): EffectProperty =>
  catalogFloat(label, value, 0, max);
const edge: EffectProperty = {
  type: "enum",
  label: "Edges",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
};

const drafts: readonly Draft[] = [
  {
    id: "owned-selective-vibrance",
    name: "Selective Vibrance",
    maxSamples: 1,
    mechanism:
      "Chroma gain is strongest near neutrals and tapers toward saturated color; a warm-direction control weights skin-adjacent hues without changing luminance or coverage.",
    properties: {
      gain: amount("Vibrance", 0.65, 2),
      neutralRange: amount("Neutral range", 0.38),
      warmPreference: amount("Warm preference", 0.35),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  if (source.a <= 0.00001 || ${p("gain")}.x <= 0.0) { return source; }
  let rgb = source.rgb / source.a;
  let luma = luminance(rgb);
  let chroma = max(max(rgb.r, rgb.g), rgb.b) - min(min(rgb.r, rgb.g), rgb.b);
  let neutral = 1.0 - smoothstep(0.0, max(${p("neutralRange")}.x, 0.00001), chroma);
  let warm = smoothstep(-0.15, 0.35, rgb.r - rgb.b);
  let influence = neutral * mix(1.0, warm, ${p("warmPreference")}.x);
  let minChannel = min(min(rgb.r, rgb.g), rgb.b);
  let chromaHeadroom = luma / max(luma - minChannel, 0.00001);
  let factor = min(1.0 + ${p("gain")}.x * influence, max(chromaHeadroom, 1.0));
  let colored = vec3f(luma) + (rgb - vec3f(luma)) * factor;
  return vec4f(colored * source.a, source.a);`,
    looks: [
      ["Quiet color", { gain: 0.45, neutralRange: 0.25, warmPreference: 0.15 }],
      [
        "Warm neutrals",
        { gain: 1.25, neutralRange: 0.55, warmPreference: 0.9 },
      ],
    ],
  },
  {
    id: "owned-threshold-solarization",
    name: "Threshold Solarization",
    maxSamples: 1,
    mechanism:
      "A luminance-triggered shoulder folds bright straight-linear channels toward their inverse while retaining lower tones, opacity, and an exactly neutral zero-strength state.",
    properties: {
      threshold: catalogFloat("Threshold", 0.62, 0.02, 0.98),
      softness: catalogFloat("Shoulder", 0.09, 0.005, 0.3),
      amount: amount("Amount", 0.8),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  if (source.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return source; }
  let rgb = source.rgb / source.a;
  let pivot = ${p("threshold")}.x;
  let softness = ${p("softness")}.x;
  let shoulder = smoothstep(pivot - softness, pivot + softness, luminance(rgb));
  let inverted = max(vec3f(1.0) - rgb, vec3f(0.0));
  let result = mix(rgb, inverted, shoulder * ${p("amount")}.x);
  return vec4f(result * source.a, source.a);`,
    looks: [
      ["Silver shoulder", { threshold: 0.74, softness: 0.045, amount: 0.65 }],
      ["Hard reversal", { threshold: 0.42, softness: 0.02, amount: 1 }],
    ],
  },
  {
    id: "owned-channel-radius-blur",
    name: "Channel Radius Blur",
    maxSamples: 28,
    mechanism:
      "Three independently weighted nine-tap spatial filters soften red, green, and blue at different radii, with alpha-weighted straight-color accumulation and the original center coverage.",
    properties: {
      redRadius: distance("Red radius", 3, 18),
      greenRadius: distance("Green radius", 1.5, 18),
      blueRadius: distance("Blue radius", 5, 18),
      amount: amount("Mix", 0.8),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return center; }
  let radii = vec3f(${p("redRadius")}.x, ${p("greenRadius")}.x, ${p("blueRadius")}.x);
  var sums = vec3f(0.0);
  var weights = vec3f(0.0);
  for (var channel = 0; channel < 3; channel += 1) {
    let radius = radii[channel];
    if (radius <= 0.0) {
      sums[channel] = center[channel];
      weights[channel] = center.a;
    } else {
      for (var tap = -4; tap <= 4; tap += 1) {
        let angle = f32(tap) * 2.39996323;
        let step = vec2f(cos(angle), sin(angle)) * f32(tap) * radius * 0.25 * globals.clock.z * globals.viewport.zw;
        let sample = sampleSource(input.uv + step);
        let weight = exp(-f32(tap * tap) * 0.125);
        sums[channel] += sample[channel] * weight;
        weights[channel] += sample.a * weight;
      }
    }
  }
  let blurred = sums / max(weights, vec3f(0.00001));
  let result = mix(center.rgb / center.a, blurred, ${p("amount")}.x);
  return vec4f(max(result, vec3f(0.0)) * center.a, center.a);`,
    looks: [
      [
        "Blue bloom",
        { redRadius: 0, greenRadius: 1, blueRadius: 8, amount: 0.65 },
      ],
      [
        "Balanced separation",
        { redRadius: 7, greenRadius: 2, blueRadius: 5, amount: 0.95 },
      ],
    ],
  },
  {
    id: "owned-three-point-tonal-map",
    name: "Three-Point Tonal Map",
    maxSamples: 1,
    mechanism:
      "A piecewise three-color lookup keyed by source luminance remaps shadows, mids, and highlights while an adjustable detail retention restores source luminance variation.",
    properties: {
      shadow: {
        type: "color",
        label: "Shadow",
        default: catalogColor(0.1, 0.18, 0.36),
      },
      midtone: {
        type: "color",
        label: "Midtone",
        default: catalogColor(0.5, 0.43, 0.4),
      },
      highlight: {
        type: "color",
        label: "Highlight",
        default: catalogColor(0.98, 0.82, 0.57),
      },
      pivot: catalogFloat("Midpoint", 0.5, 0.1, 0.9),
      detail: amount("Detail retention", 0.55),
      amount: amount("Amount", 0.75),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  if (source.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return source; }
  let rgb = source.rgb / source.a;
  let tone = clamp(luminance(rgb), 0.0, 1.0);
  let pivot = ${p("pivot")}.x;
  let low = mix(${p("shadow")}, ${p("midtone")}, smoothstep(0.0, pivot, tone));
  let high = mix(${p("midtone")}, ${p("highlight")}, smoothstep(pivot, 1.0, tone));
  let mapped = select(high, low, tone <= pivot);
  let colored = mapped.rgb + (rgb - vec3f(tone)) * ${p("detail")}.x;
  let result = mix(rgb, max(colored, vec3f(0.0)), ${p("amount")}.x * mapped.a);
  return vec4f(result * source.a, source.a);`,
    looks: [
      ["Evening print", { amount: 0.7, pivot: 0.42, detail: 0.7 }],
      [
        "Blue copper",
        {
          shadow: catalogColor(0.04, 0.15, 0.3),
          midtone: catalogColor(0.32, 0.28, 0.27),
          highlight: catalogColor(0.98, 0.56, 0.27),
          amount: 1,
        },
      ],
    ],
  },
  {
    id: "owned-film-halation",
    name: "Film Halation",
    maxSamples: 13,
    mechanism:
      "A thresholded spatial ring gathers only high-luminance neighbors and adds a warm, bounded light bleed inside the source alpha silhouette; it does not blur dark detail.",
    properties: {
      radius: distance("Halo radius", 7, 30),
      threshold: catalogFloat("Highlight threshold", 0.67, 0.1, 0.98),
      strength: amount("Halo strength", 0.45, 2),
      warmth: amount("Warmth", 0.72),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001 || ${p("strength")}.x <= 0.0 || ${p("radius")}.x <= 0.0) { return center; }
  var energy = 0.0;
  var weightSum = 0.0;
  for (var tap = 0; tap < 12; tap += 1) {
    let angle = f32(tap) * 2.39996323;
    let shell = sqrt((f32(tap) + 1.0) / 12.0);
    let displacement = vec2f(cos(angle), sin(angle)) * shell * ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
    let pixel = sampleSource(input.uv + displacement);
    if (pixel.a > 0.00001) {
      let highlight = smoothstep(${p("threshold")}.x, 1.0, luminance(pixel.rgb / pixel.a));
      let weight = 1.0 - shell * 0.5;
      energy += highlight * pixel.a * weight;
      weightSum += weight;
    }
  }
  let bleed = energy / max(weightSum, 0.00001) * ${p("strength")}.x;
  let tint = mix(vec3f(1.0), vec3f(1.0, 0.35, 0.08), ${p("warmth")}.x);
  return vec4f((center.rgb / center.a + tint * bleed) * center.a, center.a);`,
    looks: [
      [
        "Soft amber",
        { radius: 9, threshold: 0.72, strength: 0.4, warmth: 0.7 },
      ],
      [
        "Red light bleed",
        { radius: 20, threshold: 0.55, strength: 1.2, warmth: 1 },
      ],
    ],
  },
  {
    id: "owned-fluted-refraction",
    name: "Fluted Refraction",
    maxSamples: 1,
    mechanism:
      "Repeated cylindrical lenses derive horizontal ray bending from the local flute surface slope and add a narrow Fresnel-like ridge, unlike square glass cells or global lens pinching.",
    properties: {
      pitch: {
        type: "float",
        label: "Flute pitch",
        default: 18,
        min: 2,
        max: 80,
        step: 0.1,
        unit: "px",
      },
      depth: distance("Refraction depth", 8, 28),
      ridge: amount("Ridge light", 0.16),
    },
    fragment: (p) => `
  let pitch = max(${p("pitch")}.x * globals.clock.z, 1.0);
  let position = input.uv.x * globals.viewport.x / pitch;
  let local = fract(position) - 0.5;
  let slope = sin(local * 3.14159265);
  let shift = slope * ${p("depth")}.x * globals.clock.z * globals.viewport.z;
  let refracted = sampleSource(input.uv + vec2f(shift, 0.0));
  if (refracted.a <= 0.00001) { return refracted; }
  let ridge = pow(1.0 - abs(slope), 8.0) * ${p("ridge")}.x;
  return vec4f(refracted.rgb + vec3f(ridge * refracted.a), refracted.a);`,
    looks: [
      ["Fine flutes", { pitch: 12, depth: 4, ridge: 0.1 }],
      ["Deep cylinders", { pitch: 42, depth: 19, ridge: 0.28 }],
    ],
  },
];

function definitionFor(draft: Draft): EffectDefinition {
  const definition = catalogShader({
    ...draft,
    kind: "processor",
    backdrop: true,
    properties: { edge: structuredClone(edge), ...draft.properties },
  });
  return {
    ...definition,
    resources: definition.resources?.map((resource) =>
      resource.name === "color"
        ? { ...resource, format: "rgba16float" }
        : resource,
    ),
    provenance: { origin: "design-original", note: draft.mechanism },
  };
}

export const OWNED_NEXT_SIX_L_DRAFTS = drafts;
export const OWNED_NEXT_SIX_L_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(definitionFor);
export const OWNED_NEXT_SIX_L_PRESETS: readonly EffectPreset[] = drafts.flatMap(
  (draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: "layer" as const,
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
);
