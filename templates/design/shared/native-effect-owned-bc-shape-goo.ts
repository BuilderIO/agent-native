import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const FIELD_SIZE = 256;
const JUMP_STEPS = [128, 64, 32, 16, 8, 4, 2, 1] as const;

const boundarySeedWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var boundarySeeds: texture_storage_2d<rgba16float, write>;
fn inside(uv: vec2f) -> bool {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return false; }
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0).a > globals.params[0].x;
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = vec2i(textureDimensions(boundarySeeds));
  if (any(invocation.xy >= vec2u(dimensions))) { return; }
  let cell = vec2i(invocation.xy);
  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(dimensions);
  let pixel = vec2f(1.0) / vec2f(dimensions);
  let center = inside(uv);
  let boundary = center != inside(uv + vec2f(pixel.x, 0.0))
    || center != inside(uv - vec2f(pixel.x, 0.0))
    || center != inside(uv + vec2f(0.0, pixel.y))
    || center != inside(uv - vec2f(0.0, pixel.y));
  textureStore(boundarySeeds, cell, vec4f(uv, select(0.0, 1.0, boundary), 0.0));
}`;

function jumpFloodWgsl(stride: number): string {
  return `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var previousSeeds: texture_2d<f32>;
@group(0) @binding(18) var nextSeeds: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = vec2i(textureDimensions(nextSeeds));
  if (any(invocation.xy >= vec2u(dimensions))) { return; }
  let cell = vec2i(invocation.xy);
  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(dimensions);
  var best = vec4f(0.0);
  var bestDistance = 1000000.0;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let neighbor = cell + vec2i(x, y) * ${stride};
      if (any(neighbor < vec2i(0)) || any(neighbor >= dimensions)) { continue; }
      let candidate = textureLoad(previousSeeds, neighbor, 0);
      if (candidate.z < 0.5) { continue; }
      let delta = (candidate.xy - uv) * globals.viewport.xy;
      let distanceSquared = dot(delta, delta);
      if (distanceSquared < bestDistance) {
        bestDistance = distanceSquared;
        best = candidate;
      }
    }
  }
  textureStore(nextSeeds, cell, best);
}`;
}

const shapeRenderWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var nearestBoundary: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
struct Charges { points: array<vec4f, 7> };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
fn boundaryAt(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(nearestBoundary));
  let cell = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return textureLoad(nearestBoundary, cell, 0);
}
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn sourceDistance(uv: vec2f, aspect: f32) -> f32 {
  let seed = boundaryAt(uv);
  if (seed.z < 0.5) { return 10.0; }
  let distance = length((uv - seed.xy) * vec2f(aspect, 1.0));
  let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
    && sourceAt(uv).a > globals.params[0].x;
  return select(distance, -distance, inside);
}
fn worldUv(point: vec2f, aspect: f32) -> vec2f {
  return point / vec2f(aspect, -1.0) + vec2f(0.5);
}
fn smoothUnion(a: f32, b: f32, radius: f32) -> f32 {
  let blend = clamp(0.5 + 0.5 * (b - a) / max(radius, 0.0001), 0.0, 1.0);
  return mix(b, a, blend) - radius * blend * (1.0 - blend);
}
fn makeCharges(aspect: f32) -> Charges {
  var charges: Charges;
  let time = globals.clock.x * globals.params[4].x;
  for (var index = 0u; index < 7u; index += 1u) {
    let phase = f32(index) * 2.399963 + time * (0.35 + f32(index % 3u) * 0.11);
    let anchor = clamp(vec2f(0.5) + vec2f(cos(phase), sin(phase)) * (0.18 + f32(index % 3u) * 0.09), vec2f(0.0), vec2f(1.0));
    let seed = boundaryAt(anchor);
    let center = (seed.xy - vec2f(0.5)) * vec2f(aspect, -1.0)
      + vec2f(cos(phase * 1.7), sin(phase * 1.3)) * 0.045;
    let depth = sin(phase * 1.4) * globals.params[1].x * 0.75;
    charges.points[index] = vec4f(center, depth, seed.z);
  }
  return charges;
}
fn sceneDistance(point: vec3f, charges: Charges, aspect: f32) -> f32 {
  let planar = sourceDistance(worldUv(point.xy, aspect), aspect);
  let slab = abs(point.z) - globals.params[1].x;
  let corner = vec2f(planar, slab);
  var distance = length(max(corner, vec2f(0.0))) + min(max(corner.x, corner.y), 0.0);
  for (var index = 0u; index < 7u; index += 1u) {
    let charge = charges.points[index];
    if (charge.w < 0.5) { continue; }
    let ball = length(point - charge.xyz) - globals.params[2].x;
    distance = smoothUnion(distance, ball, globals.params[3].x);
  }
  return distance;
}
fn normalAt(point: vec3f, charges: Charges, aspect: f32) -> vec3f {
  let step = 0.003;
  let dx = sceneDistance(point + vec3f(step, 0.0, 0.0), charges, aspect)
    - sceneDistance(point - vec3f(step, 0.0, 0.0), charges, aspect);
  let dy = sceneDistance(point + vec3f(0.0, step, 0.0), charges, aspect)
    - sceneDistance(point - vec3f(0.0, step, 0.0), charges, aspect);
  let dz = sceneDistance(point + vec3f(0.0, 0.0, step), charges, aspect)
    - sceneDistance(point - vec3f(0.0, 0.0, step), charges, aspect);
  return normalize(vec3f(dx, dy, dz));
}
fn rotateY(point: vec3f, angle: f32) -> vec3f {
  return vec3f(cos(angle) * point.x + sin(angle) * point.z, point.y, -sin(angle) * point.x + cos(angle) * point.z);
}
fn rotateX(point: vec3f, angle: f32) -> vec3f {
  return vec3f(point.x, cos(angle) * point.y - sin(angle) * point.z, sin(angle) * point.y + cos(angle) * point.z);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[12].x;
  if (amount <= 0.0) { return source; }
  let aspect = globals.viewport.x / globals.viewport.y;
  let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, -1.0);
  let yaw = globals.params[5].x;
  let pitch = globals.params[6].x;
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 2.0), -yaw), -pitch);
  let direction = normalize(rotateX(rotateY(vec3f(screen, -2.0), -yaw), -pitch));
  let charges = makeCharges(aspect);
  var travel = 0.0;
  var found = false;
  var hit = vec3f(0.0);
  for (var step = 0u; step < 64u; step += 1u) {
    hit = origin + direction * travel;
    let distance = sceneDistance(hit, charges, aspect);
    if (distance < 0.002) { found = true; break; }
    travel += max(distance * 0.7, 0.003);
    if (travel > 4.0) { break; }
  }
  if (!found) { return source; }

  let normal = normalAt(hit, charges, aspect);
  let view = -direction;
  let light = normalize(vec3f(globals.params[10].xy, 1.0));
  let halfVector = normalize(light + view);
  let uv = worldUv(hit.xy, aspect);
  let seed = boundaryAt(uv);
  var surface = sourceAt(uv);
  if (surface.a < 0.1 && seed.z > 0.5) { surface = sourceAt(seed.xy); }
  var base = surface.rgb / max(surface.a, 0.00001);
  let tint = globals.params[11];
  base *= mix(vec3f(1.0), tint.rgb, tint.a);
  let diffuse = max(dot(normal, light), 0.0);
  let roughness = globals.params[7].x;
  let highlight = pow(max(dot(normal, halfVector), 0.0), mix(96.0, 6.0, roughness));
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  let clearcoat = globals.params[8].x * pow(max(dot(normal, halfVector), 0.0), 128.0) * fresnel;
  let thickness = 2.0 * min(globals.params[1].x, max(-sourceDistance(uv, aspect), 0.0));
  let scatter = globals.params[9].x * exp(-thickness * 8.0) * max(dot(-normal, light), 0.0);
  let lit = base * (0.18 + diffuse * 0.82 + scatter * 0.45)
    + vec3f(highlight * (1.0 - roughness) * 0.38 + clearcoat);
  let coverage = clamp(surface.a, 0.0, 1.0);
  let material = vec4f(lit * coverage, coverage);
  return mix(source, material, amount);
}`;

const color = (components: [number, number, number], alpha = 0.28) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const field = (name: string) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  size: "fixed" as const,
  width: FIELD_SIZE,
  height: FIELD_SIZE,
});

export const SHAPE_GOO_3D_EFFECT: EffectDefinition = {
  id: "an-native-owned-bc-shape-goo-3d",
  name: "Shape Goo3D",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    alphaThreshold: {
      type: "float",
      label: "Shape threshold",
      default: 0.12,
      min: 0.01,
      max: 0.9,
      step: 0.01,
    },
    depth: {
      type: "float",
      label: "Extrusion depth",
      default: 0.16,
      min: 0.04,
      max: 0.35,
      step: 0.01,
    },
    blobRadius: {
      type: "float",
      label: "Charge radius",
      default: 0.09,
      min: 0.02,
      max: 0.18,
      step: 0.01,
    },
    merge: {
      type: "float",
      label: "Goo merge",
      default: 0.1,
      min: 0,
      max: 0.2,
      step: 0.01,
    },
    motionSpeed: {
      type: "float",
      label: "Motion speed",
      default: 0.85,
      min: 0,
      max: 3,
      step: 0.01,
    },
    yaw: {
      type: "float",
      label: "Orbit yaw",
      default: 0.18,
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
    roughness: {
      type: "float",
      label: "Roughness",
      default: 0.26,
      min: 0.03,
      max: 1,
      step: 0.01,
    },
    clearcoat: {
      type: "float",
      label: "Clearcoat",
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.01,
    },
    subsurface: {
      type: "float",
      label: "Subsurface",
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.01,
    },
    light: {
      type: "vec2",
      label: "Light direction",
      default: [-0.35, 0.5],
      min: -1,
      max: 1,
    },
    tint: {
      type: "color",
      label: "Surface tint",
      default: color([0.42, 0.9, 0.76]),
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
    ...Array.from({ length: JUMP_STEPS.length - 1 }, (_, index) =>
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
      wgsl: boundarySeedWgsl,
      reads: ["source"],
      output: "seed",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    ...JUMP_STEPS.map((stride, index) => ({
      id: `jump-${stride}`,
      kind: "compute" as const,
      wgsl: jumpFloodWgsl(stride),
      reads: [index === 0 ? "seed" : `jump${index - 1}`],
      output: index === JUMP_STEPS.length - 1 ? "nearest" : `jump${index}`,
      dispatch: {
        elements: "output-texture" as const,
        workgroupSize: [8, 8, 1] as const,
      },
    })),
    {
      id: "shade-goo",
      kind: "render",
      wgsl: shapeRenderWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha distance extrusion with seven boundary-anchored 3D charges and bounded material raymarching.",
  },
};

export const SHAPE_GOO_3D_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bc-sea-glass",
    name: "Sea Glass Goo",
    definitionId: SHAPE_GOO_3D_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.12,
      depth: 0.17,
      blobRadius: 0.08,
      merge: 0.11,
      motionSpeed: 0.75,
      yaw: 0.22,
      pitch: -0.1,
      roughness: 0.22,
      clearcoat: 0.9,
      subsurface: 0.6,
      light: [-0.35, 0.5],
      tint: color([0.42, 0.9, 0.76], 0.28),
      amount: 0.92,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bc-amber-resin",
    name: "Amber Resin",
    definitionId: SHAPE_GOO_3D_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      depth: 0.26,
      blobRadius: 0.13,
      merge: 0.16,
      motionSpeed: 0.35,
      yaw: -0.3,
      pitch: 0.2,
      roughness: 0.48,
      clearcoat: 0.55,
      subsurface: 0.85,
      light: [0.42, 0.55],
      tint: color([1, 0.58, 0.16], 0.55),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const SHAPE_GOO_3D_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  SHAPE_GOO_3D_PRESETS.map((preset) => [preset.id, preset.id]),
);

export {
  FIELD_SIZE as SOURCE_SHAPE_FIELD_SIZE,
  JUMP_STEPS as SOURCE_SHAPE_JUMP_STEPS,
  boundarySeedWgsl as SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  jumpFloodWgsl as sourceShapeJumpFloodWgsl,
};
