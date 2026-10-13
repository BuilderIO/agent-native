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

const renderWgsl = `${NATIVE_GRAPH_GLOBALS}
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
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn boundaryAt(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(nearestBoundary));
  let cell = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return textureLoad(nearestBoundary, cell, 0);
}
fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn boundaryFrame(seed: vec2f, uv: vec2f) -> vec2f {
  let sourcePixel = vec2f(1.0) / vec2f(textureDimensions(sourceTexture));
  let gradient = vec2f(
    sourceAt(seed + vec2f(sourcePixel.x, 0.0)).a - sourceAt(seed - vec2f(sourcePixel.x, 0.0)).a,
    sourceAt(seed + vec2f(0.0, sourcePixel.y)).a - sourceAt(seed - vec2f(0.0, sourcePixel.y)).a
  );
  let fallback = normalize((uv - seed) * globals.viewport.xy + vec2f(0.0001, 0.0002));
  return select(fallback, normalize(gradient), dot(gradient, gradient) > 0.000001);
}
fn crystal(uv: vec2f, seed: vec2f, distance: f32) -> f32 {
  let lengthPx = globals.params[5].x * globals.clock.z;
  if (distance > lengthPx || lengthPx <= 0.0) { return 0.0; }
  let spacing = max(globals.params[6].x * globals.clock.z, 1.0);
  let seedCell = floor(seed * globals.viewport.xy / spacing);
  let chance = hash2(seedCell);
  if (chance > globals.params[4].x) { return 0.0; }
  let normal = boundaryFrame(seed, uv);
  let tangent = vec2f(-normal.y, normal.x);
  let delta = (uv - seed) * globals.viewport.xy;
  let along = dot(delta, normal);
  let across = dot(delta, tangent);
  if (along < 0.0 || along > lengthPx) { return 0.0; }
  let jitter = (hash2(seedCell + vec2f(8.0, 3.0)) - 0.5) * spacing * 0.34;
  let width = mix(1.6, 0.55, globals.params[7].x) * globals.clock.z;
  let trunk = 1.0 - smoothstep(width * 0.35, width * 1.8, abs(across - jitter));
  let generation = floor(along / spacing);
  let section = along - generation * spacing;
  let side = select(-1.0, 1.0, hash2(seedCell + vec2f(generation, 5.0)) > 0.5);
  let branchOrigin = generation * spacing + spacing * 0.17;
  let branchOffset = (along - branchOrigin) * side * (0.45 + hash2(seedCell + vec2f(generation, 12.0)) * 0.55);
  var branch = 1.0 - smoothstep(width * 0.4, width * 2.1, abs(across - jitter - branchOffset));
  branch *= select(0.0, 1.0, section > spacing * 0.17 && section < spacing * 0.87);
  let taper = pow(max(1.0 - along / lengthPx, 0.0), 1.4);
  return max(trunk, branch * 0.8) * taper;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[11].x;
  if (amount <= 0.0 || source.a <= globals.params[0].x) { return source; }
  let boundary = boundaryAt(input.uv);
  if (boundary.z < 0.5) { return source; }
  let distance = length((input.uv - boundary.xy) * globals.viewport.xy);
  let depth = globals.params[1].x * distance / max(min(globals.viewport.x, globals.viewport.y), 1.0);
  let transmission = exp(-globals.params[2].x * depth * 8.0);
  let rim = exp(-distance / max(globals.params[5].x * globals.clock.z, 0.5));
  let branch = crystal(input.uv, boundary.xy, distance);
  let seedCell = floor(boundary.xy * globals.viewport.xy / max(globals.params[6].x * globals.clock.z, 1.0));
  let grain = hash2(floor(input.uv * globals.viewport.xy / max(globals.clock.z, 1.0)) + seedCell);
  let frost = branch * (0.65 + 0.35 * grain);
  let light = vec2f(cos(globals.params[9].x), sin(globals.params[9].x));
  let normal = boundaryFrame(boundary.xy, input.uv);
  let facing = max(dot(normal, light), 0.0);
  let backlight = max(dot(-normal, light), 0.0);
  let scatter = globals.params[3].x * (rim * backlight * 0.5 + (1.0 - transmission) * 0.16);
  let sparkle = globals.params[8].x * pow(max(frost * hash2(seedCell + floor(input.uv * globals.viewport.xy)), 0.0), 8.0);
  let straightSource = source.rgb / max(source.a, 0.00001);
  let tint = globals.params[10].rgb;
  let ice = mix(straightSource, tint, 1.0 - transmission) * (0.58 + facing * 0.28 + scatter)
    + vec3f(frost * (0.55 + 0.25 * facing) + sparkle);
  let material = vec4f(ice * source.a, source.a);
  return mix(source, material, amount);
}`;

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

export const EDGE_FROST_EFFECT: EffectDefinition = {
  id: "an-native-owned-bk-edge-frost",
  name: "Edge Frost",
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
    iceDepth: {
      type: "float",
      label: "Ice depth",
      default: 0.9,
      min: 0.1,
      max: 3,
      step: 0.01,
    },
    absorption: {
      type: "float",
      label: "Absorption",
      default: 0.7,
      min: 0,
      max: 3,
      step: 0.01,
    },
    scattering: {
      type: "float",
      label: "Scattering",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    crystalDensity: {
      type: "float",
      label: "Crystal density",
      default: 0.72,
      min: 0,
      max: 1,
      step: 0.01,
    },
    branchLength: {
      type: "float",
      label: "Crystal reach",
      default: 28,
      min: 1,
      max: 120,
      step: 1,
    },
    branchScale: {
      type: "float",
      label: "Branch scale",
      default: 9,
      min: 2,
      max: 40,
      step: 1,
    },
    roughness: {
      type: "float",
      label: "Crystal roughness",
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.01,
    },
    sparkle: {
      type: "float",
      label: "Crystal glints",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    lightAngle: {
      type: "float",
      label: "Light angle",
      default: -0.65,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    iceTint: {
      type: "color",
      label: "Ice tint",
      default: color([0.43, 0.83, 0.94]),
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.95,
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
      id: "shade-edge-frost",
      kind: "render",
      wgsl: renderWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha boundary frost with anchored inward crystal branches, depth absorption, and edge-dependent scattering.",
  },
};

export const EDGE_FROST_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bk-blue-ice",
    name: "Blue Ice",
    definitionId: EDGE_FROST_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      iceDepth: 1.15,
      absorption: 0.95,
      scattering: 0.95,
      crystalDensity: 0.76,
      branchLength: 34,
      branchScale: 9,
      roughness: 0.5,
      sparkle: 0.85,
      lightAngle: -0.65,
      iceTint: color([0.34, 0.79, 0.95]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bk-rimed-glass",
    name: "Rimed Glass",
    definitionId: EDGE_FROST_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.05,
      iceDepth: 0.55,
      absorption: 0.42,
      scattering: 1.4,
      crystalDensity: 0.94,
      branchLength: 52,
      branchScale: 6,
      roughness: 0.28,
      sparkle: 1.25,
      lightAngle: 0.7,
      iceTint: color([0.76, 0.95, 1]),
      amount: 0.85,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const EDGE_FROST_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  EDGE_FROST_PRESETS.map((preset) => [preset.id, preset.id]),
);
