import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const foilWgsl = `${NATIVE_GRAPH_GLOBALS}
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
fn shapeHeight(uv: vec2f, cssSize: vec2f) -> f32 {
  let source = sourceAt(uv);
  if (source.a <= globals.params[0].x) { return 0.0; }
  let seed = boundaryAt(uv);
  if (seed.z < 0.5) { return 0.0; }
  let interior = length((uv - seed.xy) * cssSize);
  let bevel = smoothstep(0.0, max(globals.params[1].x, 0.5), interior);
  let straight = source.rgb / max(source.a, 0.00001);
  let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  return bevel * (0.55 + 0.45 * luma) * source.a;
}
fn hash2(cell: vec2f) -> f32 {
  return fract(sin(dot(cell, vec2f(127.1, 311.7))) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[10].x;
  if (amount <= 0.0 || source.a <= globals.params[0].x) { return source; }
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.01);
  let delta = vec2f(1.0) / cssSize;
  let slopeX = shapeHeight(input.uv + vec2f(delta.x, 0.0), cssSize)
    - shapeHeight(input.uv - vec2f(delta.x, 0.0), cssSize);
  let slopeY = shapeHeight(input.uv + vec2f(0.0, delta.y), cssSize)
    - shapeHeight(input.uv - vec2f(0.0, delta.y), cssSize);
  let normal = normalize(vec3f(-slopeX * globals.params[2].x, -slopeY * globals.params[2].x, 0.4));
  let light = normalize(vec3f(globals.params[8].xy, 1.0));
  let view = vec3f(0.0, 0.0, 1.0);
  let reflected = reflect(-light, normal);
  let tangent = vec2f(cos(globals.params[3].x), sin(globals.params[3].x));
  let grating = dot(reflected.xy, tangent) * globals.params[4].x;
  let phase = grating * 6.2831853 + globals.clock.x * globals.params[9].x * 2.0;
  let spectrum = vec3f(
    0.5 + 0.5 * cos(phase / 0.68),
    0.5 + 0.5 * cos(phase / 0.54 + 0.8),
    0.5 + 0.5 * cos(phase / 0.44 + 1.6)
  );
  let straight = source.rgb / max(source.a, 0.00001);
  let diffuse = max(dot(normal, light), 0.0);
  let specular = pow(max(dot(reflected, view), 0.0), 36.0);
  var foil = mix(straight * (0.25 + diffuse * 0.75), spectrum, globals.params[5].x)
    + spectrum * specular * globals.params[5].x * 0.6;
  let glitterCell = floor(input.uv * cssSize / max(globals.params[7].x, 1.0));
  let grain = hash2(glitterCell);
  let sparkle = select(0.0, pow(max(dot(reflected, view), 0.0), 80.0) * 1.8,
    grain < globals.params[6].x * 0.35);
  foil += vec3f(sparkle);
  let material = vec4f(foil * source.a, source.a);
  return mix(source, material, amount);
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

export const SHAPE_FOIL_EFFECT: EffectDefinition = {
  id: "an-native-owned-bi-shape-foil",
  name: "Shape Foil",
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
    bevelWidth: {
      type: "float",
      label: "Bevel width",
      default: 12,
      min: 1,
      max: 60,
      step: 1,
      unit: "px",
    },
    relief: {
      type: "float",
      label: "Relief",
      default: 1.2,
      min: 0.1,
      max: 5,
      step: 0.01,
    },
    foilAngle: {
      type: "float",
      label: "Foil angle",
      default: 0.35,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    diffractionPitch: {
      type: "float",
      label: "Diffraction pitch",
      default: 5,
      min: 0.5,
      max: 16,
      step: 0.1,
    },
    foilReflectance: {
      type: "float",
      label: "Foil reflectance",
      default: 0.78,
      min: 0,
      max: 1,
      step: 0.01,
    },
    glitterDensity: {
      type: "float",
      label: "Glitter density",
      default: 0.35,
      min: 0,
      max: 1,
      step: 0.01,
    },
    glitterSize: {
      type: "float",
      label: "Glitter size",
      default: 8,
      min: 2,
      max: 30,
      step: 1,
      unit: "px",
    },
    foilLight: {
      type: "vec2",
      label: "Foil light",
      default: [-0.45, 0.5],
      min: -1,
      max: 1,
    },
    foilMotion: {
      type: "float",
      label: "Foil motion",
      default: 0.25,
      min: 0,
      max: 2,
      step: 0.01,
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
      id: "shade-foil",
      kind: "render",
      wgsl: foilWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-shape heightfield normals driving angular diffraction and shape-bound microfacet glitter.",
  },
};

export const SHAPE_FOIL_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bi-prismatic-gold",
    name: "Prismatic Gold",
    definitionId: SHAPE_FOIL_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.1,
      bevelWidth: 12,
      relief: 1.2,
      foilAngle: 0.35,
      diffractionPitch: 5,
      foilReflectance: 0.78,
      glitterDensity: 0.35,
      glitterSize: 8,
      foilLight: [-0.45, 0.5],
      foilMotion: 0.25,
      amount: 0.95,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bi-spectrum-silver",
    name: "Spectrum Silver",
    definitionId: SHAPE_FOIL_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      bevelWidth: 20,
      relief: 2.1,
      foilAngle: -0.45,
      diffractionPitch: 9,
      foilReflectance: 0.92,
      glitterDensity: 0.6,
      glitterSize: 5,
      foilLight: [0.4, 0.6],
      foilMotion: 0.6,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
