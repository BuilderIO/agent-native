import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const field = (name: string) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  size: "fixed" as const,
  width: SOURCE_SHAPE_FIELD_SIZE,
  height: SOURCE_SHAPE_FIELD_SIZE,
});

const volumeWgsl = `${NATIVE_GRAPH_GLOBALS}
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
fn hash3(point: vec3f) -> f32 {
  var mixed = fract(point * vec3f(0.1031, 0.11369, 0.13787));
  mixed += dot(mixed, mixed.yzx + vec3f(33.33));
  return fract((mixed.x + mixed.y) * mixed.z);
}
fn noise3(point: vec3f) -> f32 {
  let cell = floor(point);
  let fraction = fract(point);
  let blend = fraction * fraction * (vec3f(3.0) - 2.0 * fraction);
  var sum = 0.0;
  for (var z = 0; z <= 1; z += 1) {
    for (var y = 0; y <= 1; y += 1) {
      for (var x = 0; x <= 1; x += 1) {
        let offset = vec3f(f32(x), f32(y), f32(z));
        let weights = select(vec3f(1.0) - blend, blend, vec3<bool>(x == 1, y == 1, z == 1));
        let weight = weights.x * weights.y * weights.z;
        sum += hash3(cell + offset) * weight;
      }
    }
  }
  return sum;
}
fn gas(point: vec3f) -> f32 {
  let time = globals.clock.x * globals.params[8].x;
  let coordinate = point * globals.params[2].x + vec3f(time * 0.13, -time * 0.09, time * 0.16);
  let broad = noise3(coordinate);
  let folds = noise3(coordinate * 2.15 + vec3f(7.2, 1.3, 5.8));
  let detail = noise3(coordinate * 4.3 + vec3f(1.7, 9.1, 3.4));
  let anatomy = broad * 0.56 + folds * 0.31 + detail * 0.13;
  let voidField = noise3(coordinate * 0.72 + vec3f(31.0, 17.0, 9.0));
  let cavity = smoothstep(globals.params[4].x - 0.09, globals.params[4].x + 0.09, voidField);
  return max(anatomy - 0.26, 0.0) * cavity;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[13].x;
  if (amount <= 0.0) { return source; }
  let aspect = globals.viewport.x / globals.viewport.y;
  let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, -1.0);
  let direction = normalize(vec3f(sin(globals.params[9].x), sin(globals.params[10].x), -1.0));
  let depth = globals.params[1].x;
  var transmittance = 1.0;
  var radiance = vec3f(0.0);
  var coverage = 0.0;
  let stepLength = 2.0 * depth / 32.0;
  for (var index = 0u; index < 32u; index += 1u) {
    let fraction = (f32(index) + 0.5) / 32.0;
    let z = depth * (1.0 - fraction * 2.0);
    let xy = screen + direction.xy * (depth - z) / max(-direction.z, 0.1);
    let uv = xy / vec2f(aspect, -1.0) + vec2f(0.5);
    let captured = sourceAt(uv);
    if (captured.a <= globals.params[0].x) { continue; }
    let nearest = boundaryAt(uv);
    if (nearest.z < 0.5) { continue; }
    let edgeDepth = length((uv - nearest.xy) * globals.viewport.xy);
    let edgeFade = smoothstep(0.0, 3.0 * globals.clock.z, edgeDepth);
    let worldPoint = vec3f(xy, z);
    let density = gas(worldPoint) * globals.params[3].x * edgeFade;
    let starCell = floor(worldPoint * globals.params[2].x * 8.0);
    let starChance = hash3(starCell + vec3f(19.0, 13.0, 7.0));
    let star = select(0.0, pow(hash3(worldPoint * 29.0), 20.0), starChance > 1.0 - globals.params[6].x * 0.015);
    let opacity = 1.0 - exp(-density * stepLength * 6.0);
    let hue = noise3(worldPoint * globals.params[2].x * 0.8 + vec3f(4.0));
    let color = mix(globals.params[11].rgb, globals.params[12].rgb, hue);
    radiance += transmittance * (color * opacity * globals.params[5].x + vec3f(star * globals.params[6].x * stepLength * 12.0));
    transmittance *= 1.0 - opacity;
    coverage = max(coverage, captured.a);
  }
  if (coverage <= 0.0) { return source * (1.0 - amount); }
  let seed = boundaryAt(input.uv);
  let edgeVector = (input.uv - seed.xy) * vec2f(aspect, 1.0);
  let edgeNormal = normalize(edgeVector + vec2f(0.0001, 0.0002));
  let refractedUv = input.uv + edgeNormal * globals.params[7].x * globals.clock.z * (1.0 - abs(dot(edgeNormal, normalize(direction.xy + vec2f(0.0001))))) / globals.viewport.xy;
  let refracted = sourceAt(refractedUv);
  let base = refracted.rgb / max(refracted.a, 0.00001);
  let rim = exp(-length((input.uv - seed.xy) * globals.viewport.xy) / max(globals.params[7].x * 5.0 * globals.clock.z, 1.0));
  let glass = globals.params[7].x * rim * 0.35;
  let straight = base * (0.18 + transmittance * 0.42) + radiance + vec3f(glass);
  let finalAlpha = max(source.a, coverage);
  let material = vec4f(straight * finalAlpha, finalAlpha);
  return mix(source, material, amount);
}`;

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

export const SHAPE_NEBULA_VOLUME_EFFECT: EffectDefinition = {
  id: "an-native-owned-bp-shape-nebula-volume",
  name: "Shape Nebula Volume",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    alphaThreshold: {
      type: "float",
      label: "Shape threshold",
      default: 0.08,
      min: 0.01,
      max: 0.8,
      step: 0.01,
    },
    depth: {
      type: "float",
      label: "Volume depth",
      default: 0.22,
      min: 0.04,
      max: 0.5,
      step: 0.01,
    },
    gasScale: {
      type: "float",
      label: "Gas scale",
      default: 14,
      min: 2,
      max: 40,
      step: 0.5,
    },
    density: {
      type: "float",
      label: "Gas density",
      default: 1.2,
      min: 0,
      max: 4,
      step: 0.01,
    },
    cavities: {
      type: "float",
      label: "Dark cavities",
      default: 0.5,
      min: 0.1,
      max: 0.9,
      step: 0.01,
    },
    emission: {
      type: "float",
      label: "Emission",
      default: 1.2,
      min: 0,
      max: 4,
      step: 0.01,
    },
    stars: {
      type: "float",
      label: "Internal stars",
      default: 0.6,
      min: 0,
      max: 2,
      step: 0.01,
    },
    refraction: {
      type: "float",
      label: "Glass refraction",
      default: 3,
      min: 0,
      max: 12,
      step: 0.1,
    },
    motionSpeed: {
      type: "float",
      label: "Gas motion",
      default: 0.35,
      min: 0,
      max: 2,
      step: 0.01,
    },
    yaw: {
      type: "float",
      label: "Orbit yaw",
      default: 0.2,
      min: -0.8,
      max: 0.8,
      step: 0.01,
    },
    pitch: {
      type: "float",
      label: "Orbit pitch",
      default: -0.12,
      min: -0.8,
      max: 0.8,
      step: 0.01,
    },
    colorA: {
      type: "color",
      label: "Core color",
      default: color([0.19, 0.42, 0.96]),
    },
    colorB: {
      type: "color",
      label: "Rim color",
      default: color([0.94, 0.27, 0.68]),
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.9,
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
      id: "integrate-volume",
      kind: "render",
      wgsl: volumeWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha extrusion with bounded 32-depth gas integration, cavity fields, sparse stars, and refracting glass rim.",
  },
};

export const SHAPE_NEBULA_VOLUME_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bp-electric-nebula",
    name: "Electric Nebula",
    definitionId: SHAPE_NEBULA_VOLUME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      depth: 0.22,
      gasScale: 14,
      density: 1.2,
      cavities: 0.5,
      emission: 1.4,
      stars: 0.8,
      refraction: 3,
      motionSpeed: 0.35,
      yaw: 0.2,
      pitch: -0.12,
      colorA: color([0.19, 0.42, 0.96]),
      colorB: color([0.94, 0.27, 0.68]),
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bp-ember-cloud",
    name: "Ember Cloud",
    definitionId: SHAPE_NEBULA_VOLUME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.06,
      depth: 0.34,
      gasScale: 9,
      density: 2.1,
      cavities: 0.64,
      emission: 1.8,
      stars: 0.25,
      refraction: 6,
      motionSpeed: 0.15,
      yaw: -0.3,
      pitch: 0.18,
      colorA: color([0.78, 0.11, 0.05]),
      colorB: color([1, 0.58, 0.12]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const SHAPE_NEBULA_VOLUME_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  SHAPE_NEBULA_VOLUME_PRESETS.map((preset) => [preset.id, preset.id]),
);
