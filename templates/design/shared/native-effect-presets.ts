import { CATALOG_GENERATOR_CANDIDATES } from "./native-effect-catalog-generators";
import { createCatalogEffectPresets } from "./native-effect-catalog-presets";
import { CATALOG_PROCESSOR_CANDIDATES } from "./native-effect-catalog-processors";
import {
  COLOR_GRADE_V2_EFFECT,
  COLOR_GRADE_V2_PRESETS,
} from "./native-effect-color-grade-v2";
import {
  createDensityCorrectedFrostEffect,
  createDensityCorrectedHalftoneEffect,
} from "./native-effect-density-corrected";
import { BLOOM_EFFECT, GAUSSIAN_BLUR_EFFECT } from "./native-effect-multipass";
import {
  SOURCE_GLINTS_EFFECT,
  SOURCE_GLINTS_PRESETS,
} from "./native-effect-owned-cc-source-glints";
import { NATIVE_RENDER_GLOBALS as globals } from "./native-effect-wgsl";
import { createWideColorGrainEffect } from "./native-effect-wide-color";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const orange = {
  space: "srgb",
  components: [1, 0.32, 0.08],
  alpha: 1,
} as const;
const cream = { space: "srgb", components: [1, 0.91, 0.72], alpha: 1 } as const;

export const GRAIN_GRADIENT_EFFECT: EffectDefinition = {
  id: "an-native-grain-gradient",
  name: "Orange Cream Grain Gradient",
  version: 2,
  kind: "generator",
  placements: ["fill"],
  properties: {
    orange: {
      type: "color",
      label: "Orange",
      default: { ...orange, components: [...orange.components] },
    },
    cream: {
      type: "color",
      label: "Cream",
      default: { ...cream, components: [...cream.components] },
    },
    scale: {
      type: "float",
      label: "Scale",
      default: 1,
      min: 0.25,
      max: 4,
      step: 0.01,
    },
    movement: {
      type: "float",
      label: "Movement",
      default: 0.35,
      min: 0,
      max: 2,
      step: 0.01,
    },
    grain: {
      type: "float",
      label: "Grain",
      default: 0.065,
      min: 0,
      max: 0.3,
      step: 0.001,
    },
  },
  inputs: { mask: { kind: "mask", resource: "mask", optional: true } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "mask",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba8unorm",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  output: "color",
  passes: [
    {
      id: "gradient",
      kind: "render",
      reads: [],
      output: "color",
      wgsl:
        globals +
        `
fn hash(pixel: vec2f) -> f32 {
  return fract(sin(dot(pixel, vec2f(127.1, 311.7))) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let phase = globals.clock.x * globals.params[3].x;
  let p = (uv - vec2f(0.5)) * globals.params[2].x;
  let wave = 0.5 + 0.5 * sin(p.x * 4.0 + p.y * 3.5 + phase + sin(p.y * 5.0 - phase * 0.7));
  let bloom = exp(-dot(p - vec2f(0.2 * sin(phase), 0.1 * cos(phase)), p - vec2f(0.2 * sin(phase), 0.1 * cos(phase))) * 2.6);
  let blend = clamp(wave * 0.52 + bloom * 0.36, 0.0, 1.0);
  var color = mix(globals.params[0].rgb, globals.params[1].rgb, blend);
  let alpha = mix(globals.params[0].a, globals.params[1].a, blend);
  let noise = hash(floor(uv * globals.viewport.xy) + vec2f(globals.clock.x * 23.0, globals.clock.y));
  color += (noise - 0.5) * globals.params[4].x;
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)) * alpha, alpha);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original Design native WGSL material",
  },
};

export const HALFTONE_EFFECT: EffectDefinition = {
  id: "an-native-halftone",
  name: "Halftone",
  version: 2,
  kind: "processor",
  placements: ["layer"],
  properties: {
    cellSize: {
      type: "float",
      label: "Dot size",
      default: 8,
      min: 2,
      max: 36,
      step: 0.1,
      unit: "px",
    },
    angle: {
      type: "float",
      label: "Angle",
      default: 0.4,
      min: -3.14,
      max: 3.14,
      step: 0.01,
      unit: "rad",
    },
    contrast: {
      type: "float",
      label: "Contrast",
      default: 1,
      min: 0.1,
      max: 3,
      step: 0.01,
    },
    ink: {
      type: "color",
      label: "Ink",
      default: { space: "srgb", components: [0.08, 0.06, 0.07], alpha: 1 },
    },
    paper: {
      type: "color",
      label: "Paper",
      default: { space: "srgb", components: [1, 0.96, 0.85], alpha: 1 },
    },
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba8unorm",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  output: "color",
  passes: [
    {
      id: "halftone",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl:
        globals +
        `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * globals.viewport.xy;
  let angle = globals.params[1].x;
  let rotated = vec2f(pixel.x * cos(angle) - pixel.y * sin(angle), pixel.x * sin(angle) + pixel.y * cos(angle));
  let cell = max(globals.params[0].x, 1.0);
  let center = (floor(rotated / cell) + vec2f(0.5)) * cell;
  let samplePixel = vec2f(center.x * cos(angle) + center.y * sin(angle), -center.x * sin(angle) + center.y * cos(angle));
  let sampled = textureSample(sourceTexture, effectSampler, clamp(samplePixel * globals.viewport.zw, vec2f(0.0), vec2f(1.0)));
  let straightColor = select(vec3f(0.0), sampled.rgb / max(sampled.a, 0.00001), sampled.a > 0.0);
  let luminance = dot(straightColor, vec3f(0.2126, 0.7152, 0.0722));
  let amount = clamp((1.0 - luminance) * globals.params[2].x, 0.0, 1.0);
  let radius = sqrt(amount) * cell * 0.47;
  let coverage = 1.0 - smoothstep(radius - 0.75, radius + 0.75, length(rotated - center));
  let color = mix(globals.params[4].rgb, globals.params[3].rgb, coverage);
  let paletteAlpha = mix(globals.params[4].a, globals.params[3].a, coverage);
  let alpha = sampled.a * paletteAlpha;
  return vec4f(color * alpha, alpha);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original Design source-processing WGSL",
  },
};

export const FROSTED_REFRACTION_EFFECT: EffectDefinition = {
  id: "an-native-frosted-refraction",
  name: "Frosted Refraction",
  version: 2,
  kind: "processor",
  placements: ["backdrop", "layer"],
  properties: {
    blur: {
      type: "float",
      label: "Frost",
      default: 5,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "px",
    },
    distortion: {
      type: "float",
      label: "Refraction",
      default: 7,
      min: 0,
      max: 30,
      step: 0.1,
      unit: "px",
    },
    movement: {
      type: "float",
      label: "Movement",
      default: 0.25,
      min: 0,
      max: 2,
      step: 0.01,
    },
    tint: {
      type: "color",
      label: "Tint",
      default: { space: "srgb", components: [0.95, 0.98, 1], alpha: 0.18 },
    },
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba8unorm",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  output: "color",
  passes: [
    {
      id: "refraction",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl:
        globals +
        `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let phase = globals.clock.x * globals.params[2].x;
  let ripple = vec2f(sin(uv.y * 31.0 + phase), cos(uv.x * 27.0 - phase * 0.8));
  let shifted = uv + ripple * globals.params[1].x * globals.viewport.zw;
  let step = globals.params[0].x * globals.viewport.zw * 0.35;
  var color = vec4f(0.0);
  for (var x = -1; x <= 1; x = x + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      color += textureSample(sourceTexture, effectSampler, clamp(shifted + vec2f(f32(x), f32(y)) * step, vec2f(0.0), vec2f(1.0)));
    }
  }
  color /= 9.0;
  let tinted = mix(color.rgb, globals.params[3].rgb * color.a, globals.params[3].a);
  return vec4f(tinted, color.a);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original Design backdrop/source-processing WGSL",
  },
};

export const NATIVE_EFFECT_V3_DEFINITIONS = [
  createWideColorGrainEffect(GRAIN_GRADIENT_EFFECT),
  createDensityCorrectedHalftoneEffect(HALFTONE_EFFECT),
  createDensityCorrectedFrostEffect(FROSTED_REFRACTION_EFFECT),
] as const;

const tierOneCatalogIds = new Set([
  "an-native-gradient-field",
  "an-native-mesh-anchors",
  "an-native-hex-tiles",
  "an-native-palette-map",
  "an-native-posterize",
  "an-native-pixelate",
  "an-native-film-grain",
  "an-native-chromatic-aberration",
  "an-native-sobel-edges",
]);
const tierOneCatalogDefinitions = [
  ...CATALOG_GENERATOR_CANDIDATES,
  ...CATALOG_PROCESSOR_CANDIDATES,
].filter((definition) => tierOneCatalogIds.has(definition.id));
if (tierOneCatalogDefinitions.length !== tierOneCatalogIds.size)
  throw new Error("Tier 1 native definition selection is incomplete.");

export const NATIVE_EFFECT_DEFINITION_CATALOG: readonly EffectDefinition[] = [
  ...tierOneCatalogDefinitions,
  ...NATIVE_EFFECT_V3_DEFINITIONS,
  COLOR_GRADE_V2_EFFECT,
  GAUSSIAN_BLUR_EFFECT,
  BLOOM_EFFECT,
  SOURCE_GLINTS_EFFECT,
];
export const NATIVE_EFFECT_LATEST_DEFINITIONS: readonly EffectDefinition[] =
  NATIVE_EFFECT_DEFINITION_CATALOG;

const v3LabelSourceIds: Record<string, string> = {};
const v3Recipes = NATIVE_EFFECT_V3_DEFINITIONS.flatMap((definition) =>
  createCatalogEffectPresets([definition]).map((source, index) => {
    const slug = definition.id.replace(/^an-native-/, "");
    const id = `an-preset-v3-${slug}-${index + 1}`;
    v3LabelSourceIds[id] = source.id;
    return { ...source, id };
  }),
);
export const NATIVE_PRESET_LABEL_SOURCE_IDS: Readonly<Record<string, string>> =
  v3LabelSourceIds;

export const NATIVE_EFFECT_PRESETS: readonly EffectPreset[] = [
  ...createCatalogEffectPresets([
    ...tierOneCatalogDefinitions,
    GAUSSIAN_BLUR_EFFECT,
    BLOOM_EFFECT,
  ]),
  ...v3Recipes,
  ...COLOR_GRADE_V2_PRESETS,
  ...SOURCE_GLINTS_PRESETS,
];
