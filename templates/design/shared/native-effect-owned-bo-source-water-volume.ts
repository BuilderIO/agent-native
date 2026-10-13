import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const waterWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var nearestBoundary: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
fn sourceAt(uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn boundaryAt(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(nearestBoundary));
  let cell = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return textureLoad(nearestBoundary, cell, 0);
}
fn waveAt(point: vec2f) -> f32 {
  let cssHeight = globals.viewport.y / max(globals.clock.z, 0.01);
  let wind = normalize(globals.params[4].xy + vec2f(0.0001));
  let along = dot(point * cssHeight, wind) / max(globals.params[3].x, 2.0);
  let across = dot(point * cssHeight, vec2f(-wind.y, wind.x)) / max(globals.params[3].x, 2.0);
  let time = globals.clock.x * globals.params[5].x;
  return sin(along * 6.2831853 - time * 2.1) * 0.65
    + sin((along * 0.53 + across * 0.72) * 6.2831853 - time * 1.36) * 0.35;
}
fn topHeight(point: vec2f) -> f32 {
  let cssHeight = globals.viewport.y / max(globals.clock.z, 0.01);
  return max(globals.params[1].x * 0.15,
    globals.params[1].x + globals.params[2].x * waveAt(point)) / cssHeight;
}
fn normalAt(point: vec2f) -> vec3f {
  let e = max(globals.clock.z / globals.viewport.y, 0.00001);
  return normalize(vec3f(
    -(topHeight(point + vec2f(e, 0.0)) - topHeight(point - vec2f(e, 0.0))) / (2.0 * e),
    -(topHeight(point + vec2f(0.0, e)) - topHeight(point - vec2f(0.0, e))) / (2.0 * e),
    1.0
  ));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv);
  let amount = globals.params[13].x;
  if (amount <= 0.0) { return original; }
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.01);
  let initialSeed = boundaryAt(input.uv);
  if (initialSeed.z < 0.5) { return mix(original, vec4f(0.0), amount); }
  if (original.a <= globals.params[0].x) {
    return mix(original, vec4f(0.0), amount);
  }
  let aspect = globals.viewport.x / globals.viewport.y;
  let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, -1.0);
  let normal = normalAt(screen);
  let view = vec3f(0.0, 0.0, 1.0);
  let uv = input.uv;
  let seed = initialSeed;
  let surface = original;
  let transmittedUv = uv + normal.xy * globals.params[7].x / cssSize;
  var transmitted = sourceAt(transmittedUv);
  if (transmitted.a < 0.01) { transmitted = surface; }
  let tint = globals.params[12];
  let straight = transmitted.rgb / max(transmitted.a, 0.00001)
    * mix(vec3f(1.0), tint.rgb, tint.a);
  let cssHeight = cssSize.y;
  let thickness = (topHeight(screen) + globals.params[1].x * 0.3 / cssHeight)
    / max(dot(normal, view), 0.2);
  let absorption = exp(-globals.params[6].rgb * globals.params[6].a * thickness * 10.0);
  let fresnel = globals.params[8].x * (0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 5.0));
  let reflected = vec3f(0.24, 0.48, 0.67) * (0.45 + max(normal.z, 0.0) * 0.55);
  let edgeCss = length((uv - seed.xy) * cssSize);
  let foam = (1.0 - smoothstep(0.0, max(globals.params[9].x, 0.5), edgeCss))
    * globals.params[10].x;
  let e = 2.0 / cssHeight;
  let center = waveAt(screen);
  let curvature = abs(waveAt(screen + vec2f(e, 0.0)) - 2.0 * center + waveAt(screen - vec2f(e, 0.0)))
    + abs(waveAt(screen + vec2f(0.0, e)) - 2.0 * center + waveAt(screen - vec2f(0.0, e)));
  let caustic = pow(clamp(curvature * 2.0, 0.0, 1.0), 2.0) * globals.params[11].x;
  var water = mix(straight * absorption + vec3f(caustic), reflected, fresnel);
  water = mix(water, vec3f(0.78, 0.94, 1.0), clamp(foam, 0.0, 1.0));
  let coverage = surface.a;
  return mix(original, vec4f(water * coverage, coverage), amount);
}`;

const field = (name: string) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  size: "fixed" as const,
  width: SOURCE_SHAPE_FIELD_SIZE,
  height: SOURCE_SHAPE_FIELD_SIZE,
});
const color = (components: [number, number, number], alpha: number) => ({
  space: "srgb" as const,
  components,
  alpha,
});

export const SOURCE_WATER_VOLUME_EFFECT: EffectDefinition = {
  id: "an-native-owned-bo-source-water-volume",
  name: "Source Water Volume",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    alphaThreshold: {
      type: "float",
      label: "Shape threshold",
      default: 0.1,
      min: 0.01,
      max: 0.9,
      step: 0.01,
    },
    waterDepth: {
      type: "float",
      label: "Water depth",
      default: 32,
      min: 4,
      max: 120,
      step: 1,
      unit: "px",
    },
    waveHeight: {
      type: "float",
      label: "Wave height",
      default: 5,
      min: 0,
      max: 24,
      step: 0.5,
      unit: "px",
    },
    waveLength: {
      type: "float",
      label: "Wave length",
      default: 44,
      min: 8,
      max: 160,
      step: 1,
      unit: "px",
    },
    windDirection: {
      type: "vec2",
      label: "Wind direction",
      default: [0.8, 0.25],
      min: -1,
      max: 1,
    },
    windSpeed: {
      type: "float",
      label: "Wind speed",
      default: 0.65,
      min: 0,
      max: 3,
      step: 0.01,
    },
    waterAbsorption: {
      type: "color",
      label: "Water absorption",
      default: color([0.58, 0.24, 0.12], 0.62),
    },
    waterRefraction: {
      type: "float",
      label: "Water refraction",
      default: 9,
      min: 0,
      max: 30,
      step: 0.5,
      unit: "px",
    },
    waterFresnel: {
      type: "float",
      label: "Water Fresnel",
      default: 0.82,
      min: 0,
      max: 1,
      step: 0.01,
    },
    foamWidth: {
      type: "float",
      label: "Foam width",
      default: 8,
      min: 1,
      max: 36,
      step: 1,
      unit: "px",
    },
    foamStrength: {
      type: "float",
      label: "Foam strength",
      default: 0.48,
      min: 0,
      max: 1,
      step: 0.01,
    },
    causticStrength: {
      type: "float",
      label: "Caustic strength",
      default: 0.55,
      min: 0,
      max: 2,
      step: 0.01,
    },
    waterTint: {
      type: "color",
      label: "Water tint",
      default: color([0.24, 0.78, 0.94], 0.38),
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.92,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
    field("seed"),
    ...Array.from({ length: SOURCE_SHAPE_JUMP_STEPS.length - 1 }, (_, index) =>
      field(`jump${index}`),
    ),
    field("nearest"),
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "seed-boundary",
      kind: "compute",
      wgsl: SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
      reads: ["source"],
      output: "seed",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    ...SOURCE_SHAPE_JUMP_STEPS.map((stride, index) => ({
      id: `jump-${stride}`,
      kind: "compute" as const,
      wgsl: sourceShapeJumpFloodWgsl(stride),
      reads: [index === 0 ? "seed" : `jump${index - 1}`],
      output:
        index === SOURCE_SHAPE_JUMP_STEPS.length - 1
          ? "nearest"
          : `jump${index}`,
      dispatch: {
        elements: "output-texture" as const,
        workgroupSize: [8, 8, 1] as const,
      },
    })),
    {
      id: "trace-water",
      kind: "render",
      wgsl: waterWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha water slab with exact orthographic wave-surface intersection, depth absorption, Fresnel reflection, edge foam, and curvature caustics.",
  },
};

export const SOURCE_WATER_VOLUME_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bo-tidal-glass",
    name: "Tidal Glass",
    definitionId: SOURCE_WATER_VOLUME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.1,
      waterDepth: 32,
      waveHeight: 5,
      waveLength: 44,
      windDirection: [0.8, 0.25],
      windSpeed: 0.65,
      waterAbsorption: color([0.58, 0.24, 0.12], 0.62),
      waterRefraction: 9,
      waterFresnel: 0.82,
      foamWidth: 8,
      foamStrength: 0.48,
      causticStrength: 0.55,
      waterTint: color([0.24, 0.78, 0.94], 0.38),
      amount: 0.92,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bo-deep-current",
    name: "Deep Current",
    definitionId: SOURCE_WATER_VOLUME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.07,
      waterDepth: 66,
      waveHeight: 9,
      waveLength: 72,
      windDirection: [-0.48, 0.62],
      windSpeed: 1.15,
      waterAbsorption: color([0.72, 0.34, 0.16], 0.8),
      waterRefraction: 17,
      waterFresnel: 0.92,
      foamWidth: 13,
      foamStrength: 0.68,
      causticStrength: 1.1,
      waterTint: color([0.1, 0.5, 0.73], 0.62),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
