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
fn towHeight(uv: vec2f) -> vec4f {
  let angle = globals.params[3].x;
  let center = (uv - vec2f(0.5)) * globals.viewport.xy / max(min(globals.viewport.x, globals.viewport.y), 1.0);
  let rotated = vec2f(cos(angle) * center.x - sin(angle) * center.y,
                      sin(angle) * center.x + cos(angle) * center.y);
  let grid = rotated * globals.params[1].x;
  let cell = floor(grid);
  let local = fract(grid) - vec2f(0.5);
  let twill = u32(globals.params[2].x) == 1u;
  let over = select(i32(cell.x + cell.y) & 1, i32(cell.x - 2.0 * floor(cell.y / 2.0)) & 3, twill);
  let warpOver = select(over == 0, over < 2, twill);
  let across = select(local.y, local.x, warpOver);
  let crown = pow(max(cos(across * 3.14159265), 0.0), 1.5);
  let seam = 1.0 - smoothstep(0.32, 0.48, abs(across));
  let height = globals.params[4].x * crown * seam;
  let tangent = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), warpOver);
  let direction = vec2f(cos(angle) * tangent.x + sin(angle) * tangent.y,
                        -sin(angle) * tangent.x + cos(angle) * tangent.y);
  let fiber = 0.85 + 0.15 * hash2(cell + vec2f(floor(local.x * 40.0), floor(local.y * 40.0)));
  return vec4f(height, direction * fiber, seam);
}
fn reliefNormal(uv: vec2f, edgeDistance: f32) -> vec3f {
  let pixel = vec2f(1.0) / globals.viewport.xy;
  let hx = towHeight(uv + vec2f(pixel.x, 0.0)).x - towHeight(uv - vec2f(pixel.x, 0.0)).x;
  let hy = towHeight(uv + vec2f(0.0, pixel.y)).x - towHeight(uv - vec2f(0.0, pixel.y)).x;
  let bevel = clamp(edgeDistance / max(globals.params[9].x, 0.0001), 0.0, 1.0);
  return normalize(vec3f(-hx * 24.0, -hy * 24.0, mix(0.35, 1.0, bevel)));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[13].x;
  if (amount <= 0.0 || source.a <= globals.params[0].x) { return source; }
  let boundary = boundaryAt(input.uv);
  if (boundary.z < 0.5) { return source; }
  let edgeDistance = length((input.uv - boundary.xy) * globals.viewport.xy);
  let tow = towHeight(input.uv);
  let normal = reliefNormal(input.uv, edgeDistance);
  let lightAngle = globals.params[10].x;
  let light = normalize(vec3f(cos(lightAngle) * 0.58, sin(lightAngle) * 0.58, 0.82));
  let view = vec3f(0.0, 0.0, 1.0);
  let halfVector = normalize(light + view);
  let tangent = normalize(vec3f(tow.yz, 0.0));
  let transverse = normalize(cross(normal, tangent));
  let anisotropy = exp(-pow(dot(halfVector, tangent) / max(globals.params[6].x, 0.04), 2.0) * 2.0)
    * pow(max(dot(halfVector, normal), 0.0), 8.0);
  let directional = pow(max(abs(dot(halfVector, transverse)), 0.0), 2.0);
  let fiberSpecular = globals.params[5].x * anisotropy * (0.28 + directional * 0.72);
  let straightSource = source.rgb / max(source.a, 0.00001);
  let dark = globals.params[11].rgb;
  let bright = globals.params[12].rgb;
  let face = mix(dark, bright, tow.x * 0.35 + 0.16) * straightSource;
  let diffuse = max(dot(normal, light), 0.0);
  let studio = pow(max(dot(reflect(-light, normal), view), 0.0), 36.0);
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  let clearcoat = globals.params[7].x * globals.params[8].x * studio * fresnel;
  let shade = face * (0.27 + 0.73 * diffuse) + bright * (fiberSpecular + clearcoat);
  let material = vec4f(shade * source.a, source.a);
  return mix(source, material, amount);
}`;

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

export const RAISED_CARBON_WEAVE_EFFECT: EffectDefinition = {
  id: "an-native-owned-bj-raised-carbon-weave",
  name: "Raised Carbon Weave",
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
    weaveScale: {
      type: "float",
      label: "Tow density",
      default: 56,
      min: 8,
      max: 180,
      step: 1,
    },
    weaveMode: {
      type: "enum",
      label: "Weave",
      default: "plain",
      options: ["plain", "twill"],
    },
    rotation: {
      type: "float",
      label: "Weave rotation",
      default: 0.4,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    relief: {
      type: "float",
      label: "Raised relief",
      default: 0.65,
      min: 0,
      max: 1.5,
      step: 0.01,
    },
    fiberSheen: {
      type: "float",
      label: "Fiber sheen",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    sheenWidth: {
      type: "float",
      label: "Sheen width",
      default: 0.25,
      min: 0.04,
      max: 1,
      step: 0.01,
    },
    clearcoat: {
      type: "float",
      label: "Clearcoat",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    studio: {
      type: "float",
      label: "Studio reflection",
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
    },
    bevelWidth: {
      type: "float",
      label: "Edge bevel",
      default: 7,
      min: 0.5,
      max: 36,
      step: 0.5,
    },
    lightAngle: {
      type: "float",
      label: "Light angle",
      default: -0.7,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    darkColor: {
      type: "color",
      label: "Resin",
      default: color([0.12, 0.16, 0.2]),
    },
    brightColor: {
      type: "color",
      label: "Fiber",
      default: color([0.55, 0.65, 0.74]),
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 1,
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
      id: "shade-raised-weave",
      kind: "render",
      wgsl: renderWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha boundary extrusion with raised alternating tow relief, direction-dependent fiber sheen and a studio clearcoat.",
  },
};

export const RAISED_CARBON_WEAVE_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bj-graphite-lacquer",
    name: "Graphite Lacquer",
    definitionId: RAISED_CARBON_WEAVE_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      weaveScale: 64,
      weaveMode: "plain",
      rotation: 0.4,
      relief: 0.68,
      fiberSheen: 0.86,
      sheenWidth: 0.21,
      clearcoat: 0.9,
      studio: 1.1,
      bevelWidth: 6,
      lightAngle: -0.7,
      darkColor: color([0.1, 0.14, 0.18]),
      brightColor: color([0.56, 0.64, 0.72]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bj-copper-twill",
    name: "Copper Twill",
    definitionId: RAISED_CARBON_WEAVE_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.1,
      weaveScale: 38,
      weaveMode: "twill",
      rotation: -0.22,
      relief: 1.05,
      fiberSheen: 1.25,
      sheenWidth: 0.35,
      clearcoat: 0.56,
      studio: 1.4,
      bevelWidth: 13,
      lightAngle: 0.85,
      darkColor: color([0.25, 0.08, 0.04]),
      brightColor: color([0.95, 0.43, 0.18]),
      amount: 0.92,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const RAISED_CARBON_WEAVE_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  RAISED_CARBON_WEAVE_PRESETS.map((preset) => [preset.id, preset.id]),
);
