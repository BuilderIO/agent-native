import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const hologramWgsl = `${NATIVE_GRAPH_GLOBALS}
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
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv);
  let amount = globals.params[9].x;
  if (amount <= 0.0) { return original; }
  let density = globals.params[2].x;
  let tint = globals.params[8];
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.01);
  let tilt = globals.params[3].xy;
  let depthCss = globals.params[1].x;
  let time = globals.clock.x * globals.params[7].x;
  var accumulated = vec4f(0.0);
  for (var layer = 0u; layer < 16u; layer += 1u) {
    let depth = (f32(layer) + 0.5) / 16.0;
    let uv = input.uv + tilt * (depth - 0.5) * depthCss / cssSize;
    let source = sourceAt(uv);
    if (source.a <= globals.params[0].x) { continue; }
    let seed = boundaryAt(uv);
    if (seed.z < 0.5) { continue; }
    let edgeCss = length((uv - seed.xy) * cssSize);
    let edge = exp(-edgeCss / max(globals.params[5].x, 0.5));
    let scanCoordinate = uv.y * cssSize.y * globals.params[4].x + time * 17.0 - depth * 6.0;
    let scan = 0.64 + 0.36 * sin(scanCoordinate * 6.2831853);
    let beam = exp(-abs(depth - 0.5) * globals.params[6].x * 2.0);
    let absorption = source.a * density * (0.28 + edge * 0.72) * scan * beam / 16.0;
    let stepAlpha = clamp(1.0 - exp(-absorption * 5.0), 0.0, 1.0);
    let straight = source.rgb / max(source.a, 0.00001);
    let spectral = vec3f(0.74 + edge * 0.26, 0.85 + scan * 0.15, 1.0);
    let color = straight * mix(vec3f(1.0), tint.rgb, tint.a) * spectral;
    accumulated = accumulated + vec4f(color * stepAlpha, stepAlpha) * (1.0 - accumulated.a);
    if (accumulated.a >= 0.995) { break; }
  }
  return mix(original, accumulated, amount);
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

const tint = (components: [number, number, number], alpha: number) => ({
  space: "srgb" as const,
  components,
  alpha,
});

export const HOLOGRAM_VOLUME_EFFECT: EffectDefinition = {
  id: "an-native-owned-bh-hologram-volume",
  name: "Hologram Volume",
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
    volumeDepth: {
      type: "float",
      label: "Volume depth",
      default: 54,
      min: 1,
      max: 180,
      step: 1,
      unit: "px",
    },
    volumeDensity: {
      type: "float",
      label: "Volume density",
      default: 1.3,
      min: 0.1,
      max: 4,
      step: 0.01,
    },
    volumeTilt: {
      type: "vec2",
      label: "Volume tilt",
      default: [0.55, -0.2],
      min: -1,
      max: 1,
    },
    scanFrequency: {
      type: "float",
      label: "Scan frequency",
      default: 0.08,
      min: 0.01,
      max: 0.5,
      step: 0.01,
    },
    edgeReach: {
      type: "float",
      label: "Edge reach",
      default: 7,
      min: 1,
      max: 40,
      step: 1,
      unit: "px",
    },
    beamFalloff: {
      type: "float",
      label: "Beam falloff",
      default: 0.6,
      min: 0,
      max: 3,
      step: 0.01,
    },
    scanSpeed: {
      type: "float",
      label: "Scan speed",
      default: 0.55,
      min: 0,
      max: 3,
      step: 0.01,
    },
    hologramTint: {
      type: "color",
      label: "Hologram tint",
      default: tint([0.22, 0.85, 1], 0.68),
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
      id: "integrate-volume",
      kind: "render",
      wgsl: hologramWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded volumetric integration through a source-alpha shape with depth-parallax scan planes.",
  },
};

export const HOLOGRAM_VOLUME_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bh-blue-signal",
    name: "Blue Signal",
    definitionId: HOLOGRAM_VOLUME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.1,
      volumeDepth: 54,
      volumeDensity: 1.3,
      volumeTilt: [0.55, -0.2],
      scanFrequency: 0.08,
      edgeReach: 7,
      beamFalloff: 0.6,
      scanSpeed: 0.55,
      hologramTint: tint([0.22, 0.85, 1], 0.68),
      amount: 0.95,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bh-amber-archive",
    name: "Amber Archive",
    definitionId: HOLOGRAM_VOLUME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.07,
      volumeDepth: 82,
      volumeDensity: 2,
      volumeTilt: [-0.34, 0.14],
      scanFrequency: 0.12,
      edgeReach: 12,
      beamFalloff: 1.2,
      scanSpeed: 0.18,
      hologramTint: tint([1, 0.54, 0.16], 0.82),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
