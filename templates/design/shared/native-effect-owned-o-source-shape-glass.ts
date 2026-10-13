import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const glassWgsl = `${NATIVE_GRAPH_GLOBALS}
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
fn heightAt(uv: vec2f, cssSize: vec2f) -> f32 {
  if (sourceAt(uv).a <= globals.params[0].x) { return 0.0; }
  let seed = boundaryAt(uv);
  if (seed.z < 0.5) { return 0.0; }
  let distanceCss = length((uv - seed.xy) * cssSize);
  return globals.params[1].x * (1.0 - exp(-distanceCss / max(globals.params[2].x, 0.5)));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv);
  let amount = globals.params[7].x;
  if (amount <= 0.0 || original.a <= 0.00001) { return original; }
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.01);
  let pixel = 1.0 / cssSize;
  let height = heightAt(input.uv, cssSize);
  if (height <= 0.0) { return original; }
  let gradient = vec2f(
    heightAt(input.uv + vec2f(pixel.x, 0.0), cssSize) - heightAt(input.uv - vec2f(pixel.x, 0.0), cssSize),
    heightAt(input.uv + vec2f(0.0, pixel.y), cssSize) - heightAt(input.uv - vec2f(0.0, pixel.y), cssSize)
  ) * 0.5;
  let normal = normalize(vec3f(-gradient, 1.0));
  let displacement = gradient * globals.params[3].x * pixel;
  let chroma = gradient * globals.params[4].x * pixel;
  let middle = sourceAt(input.uv + displacement);
  let red = sourceAt(input.uv + displacement + chroma);
  let blue = sourceAt(input.uv + displacement - chroma);
  let originalStraight = original.rgb / max(original.a, 0.00001);
  let middleStraight = select(originalStraight, middle.rgb / max(middle.a, 0.00001), middle.a > 0.00001);
  let redStraight = select(originalStraight, red.rgb / max(red.a, 0.00001), red.a > 0.00001);
  let blueStraight = select(originalStraight, blue.rgb / max(blue.a, 0.00001), blue.a > 0.00001);
  let refracted = vec3f(redStraight.r, middleStraight.g, blueStraight.b);
  let tint = globals.params[6];
  let tinted = mix(refracted, tint.rgb, tint.a);
  let fresnel = globals.params[5].x * pow(1.0 - clamp(normal.z, 0.0, 1.0), 5.0);
  let glass = clamp(tinted + vec3f(fresnel), vec3f(0.0), vec3f(1.0));
  return vec4f(mix(originalStraight, glass, amount) * original.a, original.a);
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

export const SOURCE_SHAPE_GLASS_EFFECT: EffectDefinition = {
  id: "an-native-owned-source-shape-glass",
  name: "Source Shape Glass",
  version: 1,
  kind: "processor",
  placements: ["layer"],
  properties: {
    shapeThreshold: {
      type: "float",
      label: "Shape threshold",
      default: 0.1,
      min: 0.01,
      max: 0.9,
      step: 0.01,
    },
    thickness: {
      type: "float",
      label: "Thickness",
      default: 30,
      min: 0,
      max: 100,
      step: 1,
      unit: "px",
    },
    edgeSoftness: {
      type: "float",
      label: "Edge softness",
      default: 14,
      min: 1,
      max: 80,
      step: 1,
      unit: "px",
    },
    bend: {
      type: "float",
      label: "Bend",
      default: 9,
      min: 0,
      max: 30,
      step: 0.5,
      unit: "px",
    },
    dispersion: {
      type: "float",
      label: "Dispersion",
      default: 1.5,
      min: 0,
      max: 8,
      step: 0.5,
      unit: "px",
    },
    fresnel: {
      type: "float",
      label: "Reflection",
      default: 0.36,
      min: 0,
      max: 1,
      step: 0.01,
    },
    glassTint: {
      type: "color",
      label: "Glass tint",
      default: color([0.76, 0.9, 0.98], 0.2),
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
      id: "refract-shape",
      kind: "render",
      wgsl: glassWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Source-alpha boundary thickness drives the refraction normal, chromatic separation, and Fresnel reflection inside the selected layer silhouette.",
  },
};

export const SOURCE_SHAPE_GLASS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-o-source-shape-glass-cut-crystal",
    name: "Cut Crystal",
    definitionId: SOURCE_SHAPE_GLASS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      shapeThreshold: 0.1,
      thickness: 30,
      edgeSoftness: 14,
      bend: 9,
      dispersion: 1.5,
      fresnel: 0.36,
      glassTint: color([0.76, 0.9, 0.98], 0.2),
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-o-source-shape-glass-soft-silica",
    name: "Soft Silica",
    definitionId: SOURCE_SHAPE_GLASS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      shapeThreshold: 0.06,
      thickness: 52,
      edgeSoftness: 32,
      bend: 5,
      dispersion: 0.5,
      fresnel: 0.18,
      glassTint: color([0.85, 0.95, 1], 0.32),
      amount: 0.84,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
