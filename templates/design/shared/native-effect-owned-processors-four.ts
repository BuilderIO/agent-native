import {
  CATALOG_EDGE,
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
};

const pixelRadius = (
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

const drafts: readonly Draft[] = [
  {
    id: "owned-bilateral-surface",
    name: "Bilateral Surface",
    mechanism:
      "A 5×5 joint spatial and color-distance filter smooths within regions while retaining chromatic edges and the authored alpha silhouette.",
    properties: {
      radius: pixelRadius("Radius", 3, 12),
      colorSeparation: catalogFloat("Color separation", 0.14, 0.015, 1.5),
      amount: catalogFloat("Amount", 0.8, 0, 1),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001 || ${p("amount")}.x <= 0.0 || ${p("radius")}.x <= 0.0) { return center; }
  let centerStraight = center.rgb / center.a;
  let stepUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw * 0.5;
  let colorScale = max(${p("colorSeparation")}.x, 0.015);
  var sumColor = vec3f(0.0);
  var sumWeight = 0.0;
  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      let pixel = sampleSource(input.uv + vec2f(f32(x), f32(y)) * stepUv);
      if (pixel.a > 0.00001) {
        let straightColor = pixel.rgb / pixel.a;
        let delta = straightColor - centerStraight;
        let spatial = f32(x * x + y * y);
        let weight = exp(-spatial * 0.25 - dot(delta, delta) / (2.0 * colorScale * colorScale));
        sumColor += pixel.rgb * weight;
        sumWeight += pixel.a * weight;
      }
    }
  }
  let smoothed = sumColor / max(sumWeight, 0.00001);
  let outColor = mix(centerStraight, smoothed, ${p("amount")}.x);
  return vec4f(max(outColor, vec3f(0.0)) * center.a, center.a);`,
    looks: [
      ["Portrait surface", { radius: 2.5, colorSeparation: 0.1, amount: 0.65 }],
      ["Graphic regions", { radius: 7, colorSeparation: 0.035, amount: 0.95 }],
    ],
  },
  {
    id: "owned-local-rank-contrast",
    name: "Local Rank Contrast",
    mechanism:
      "A 5×5 local luminance rank adjusts each pixel relative to its neighbors; uniform fields are identity and original alpha is preserved.",
    properties: {
      radius: pixelRadius("Neighborhood", 2, 10),
      strength: catalogFloat("Rank contrast", 0.85, 0, 2),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  if (center.a <= 0.00001 || ${p("strength")}.x <= 0.0 || ${p("radius")}.x <= 0.0) { return center; }
  let straightColor = center.rgb / center.a;
  let centerLuma = luminance(straightColor);
  let stepUv = ${p("radius")}.x * globals.clock.z * globals.viewport.zw * 0.5;
  var rankSum = 0.0;
  var count = 0.0;
  var low = centerLuma;
  var high = centerLuma;
  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      let pixel = sampleSource(input.uv + vec2f(f32(x), f32(y)) * stepUv);
      if (pixel.a > 0.00001) {
        let tone = luminance(pixel.rgb / pixel.a);
        rankSum += select(0.0, 1.0, tone < centerLuma - 0.0001);
        rankSum += select(0.0, 0.5, abs(tone - centerLuma) <= 0.0001);
        count += 1.0;
        low = min(low, tone);
        high = max(high, tone);
      }
    }
  }
  let localRange = high - low;
  if (count <= 1.0 || localRange <= 0.0001) { return center; }
  let percentile = rankSum / count;
  let targetLuma = max(0.0, centerLuma + (percentile - 0.5) * localRange * ${p("strength")}.x);
  let adjusted = straightColor * (targetLuma / max(centerLuma, 0.00001));
  return vec4f(max(adjusted, vec3f(0.0)) * center.a, center.a);`,
    looks: [
      ["Local clarity", { radius: 2, strength: 0.55 }],
      ["Ranked relief", { radius: 6, strength: 1.5 }],
    ],
  },
  {
    id: "owned-alpha-pinhole-repair",
    name: "Alpha Pinhole Repair",
    mechanism:
      "Opposing opaque neighbors on both axes identify enclosed transparent defects, then reconstruct color and coverage without dilating the outer silhouette.",
    properties: {
      radius: pixelRadius("Repair radius", 1, 6),
      threshold: catalogFloat("Coverage threshold", 0.5, 0.05, 0.95),
      strength: catalogFloat("Repair strength", 1, 0, 1),
    },
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let threshold = ${p("threshold")}.x;
  if (center.a >= threshold || ${p("radius")}.x <= 0.0 || ${p("strength")}.x <= 0.0) { return center; }
  let d = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  let left = sampleSource(input.uv - vec2f(d.x, 0.0));
  let right = sampleSource(input.uv + vec2f(d.x, 0.0));
  let top = sampleSource(input.uv - vec2f(0.0, d.y));
  let bottom = sampleSource(input.uv + vec2f(0.0, d.y));
  if (min(min(left.a, right.a), min(top.a, bottom.a)) < threshold) { return center; }
  let diagonalA = sampleSource(input.uv + vec2f(d.x, d.y));
  let diagonalB = sampleSource(input.uv + vec2f(-d.x, d.y));
  let diagonalC = sampleSource(input.uv + vec2f(d.x, -d.y));
  let diagonalD = sampleSource(input.uv - d);
  let colorSum = left.rgb + right.rgb + top.rgb + bottom.rgb +
    (diagonalA.rgb + diagonalB.rgb + diagonalC.rgb + diagonalD.rgb) * 0.5;
  let alphaSum = left.a + right.a + top.a + bottom.a +
    (diagonalA.a + diagonalB.a + diagonalC.a + diagonalD.a) * 0.5;
  let repairedColor = colorSum / max(alphaSum, 0.00001);
  let repairedAlpha = alphaSum / 6.0;
  let blend = ${p("strength")}.x * (1.0 - center.a / threshold);
  let outAlpha = mix(center.a, repairedAlpha, blend);
  let originalColor = select(vec3f(0.0), center.rgb / max(center.a, 0.00001), center.a > 0.00001);
  let outColor = mix(originalColor, repairedColor, blend);
  return vec4f(outColor * outAlpha, outAlpha);`,
    looks: [
      ["Fine repair", { radius: 1, threshold: 0.7, strength: 0.8 }],
      ["Scan cleanup", { radius: 3, threshold: 0.45, strength: 1 }],
    ],
  },
  {
    id: "owned-luminance-split-tone",
    name: "Luminance Split Tone",
    mechanism:
      "Shadow and highlight chroma are applied multiplicatively to source color, each renormalized to keep source luminance and alpha.",
    properties: {
      shadowTint: {
        type: "color",
        label: "Shadow tint",
        default: catalogColor(0.27, 0.48, 0.76),
      },
      highlightTint: {
        type: "color",
        label: "Highlight tint",
        default: catalogColor(0.99, 0.69, 0.35),
      },
      midpoint: catalogFloat("Midpoint", 0.5, 0.05, 0.95),
      spread: catalogFloat("Transition width", 0.25, 0.02, 0.5),
      amount: catalogFloat("Tint amount", 0.65, 0, 1),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  if (source.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return source; }
  let rgb = source.rgb / source.a;
  let sourceLuma = luminance(rgb);
  let low = 1.0 - smoothstep(${p("midpoint")}.x - ${p("spread")}.x, ${p("midpoint")}.x, sourceLuma);
  let high = smoothstep(${p("midpoint")}.x, ${p("midpoint")}.x + ${p("spread")}.x, sourceLuma);
  let tint = vec3f(1.0) * (1.0 - low - high) + ${p("shadowTint")}.rgb * low + ${p("highlightTint")}.rgb * high;
  let colored = rgb * tint;
  let normalized = colored * (sourceLuma / max(luminance(colored), 0.00001));
  let weight = ${p("amount")}.x * (low * ${p("shadowTint")}.a + high * ${p("highlightTint")}.a);
  let result = mix(rgb, normalized, weight);
  return vec4f(max(result, vec3f(0.0)) * source.a, source.a);`,
    looks: [
      ["Cool shadow warmth", { amount: 0.55, midpoint: 0.46 }],
      [
        "Copper dusk",
        {
          shadowTint: catalogColor(0.19, 0.31, 0.64),
          highlightTint: catalogColor(0.96, 0.44, 0.18),
          amount: 0.9,
        },
      ],
    ],
  },
];

function ownedDefinition(draft: Draft): EffectDefinition {
  const definition = catalogShader({
    ...draft,
    kind: "processor",
    backdrop: true,
    properties: { edge: structuredClone(CATALOG_EDGE), ...draft.properties },
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

export const OWNED_PROCESSOR_FOUR_DRAFTS = drafts;
export const OWNED_PROCESSOR_FOUR_DEFINITIONS: readonly EffectDefinition[] =
  drafts.map(ownedDefinition);
export const OWNED_PROCESSOR_FOUR_PRESETS: readonly EffectPreset[] =
  drafts.flatMap((draft) =>
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
