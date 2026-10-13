import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const crystalWgsl = `${NATIVE_GRAPH_GLOBALS}
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
fn worldUv(point: vec2f, aspect: f32) -> vec2f {
  return point / vec2f(aspect, -1.0) + vec2f(0.5);
}
fn sourceDistance(uv: vec2f, aspect: f32) -> f32 {
  let seed = boundaryAt(uv);
  if (seed.z < 0.5) { return 10.0; }
  let distance = length((uv - seed.xy) * vec2f(aspect, 1.0));
  let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
    && sourceAt(uv).a > globals.params[0].x;
  return select(distance, -distance, inside);
}
fn vertexHeight(vertex: vec2f) -> f32 {
  return fract(sin(dot(vertex, vec2f(127.1, 311.7))) * 43758.5453);
}
fn topHeight(point: vec2f) -> f32 {
  let grid = point * globals.params[2].x;
  let cell = floor(grid);
  let local = fract(grid);
  let a = vertexHeight(cell);
  let b = vertexHeight(cell + vec2f(1.0, 0.0));
  let c = vertexHeight(cell + vec2f(0.0, 1.0));
  let d = vertexHeight(cell + vec2f(1.0, 1.0));
  var plane = a * (1.0 - local.x - local.y) + b * local.x + c * local.y;
  if (local.x + local.y > 1.0) {
    plane = d * (local.x + local.y - 1.0) + b * (1.0 - local.y) + c * (1.0 - local.x);
  }
  return globals.params[1].x * (0.65 + globals.params[3].x * (plane - 0.5));
}
fn sceneDistance(point: vec3f, aspect: f32) -> f32 {
  let planar = sourceDistance(worldUv(point.xy, aspect), aspect);
  let top = point.z - topHeight(point.xy);
  let bottom = -point.z - globals.params[1].x * 0.5;
  let slab = max(top, bottom);
  let corner = vec2f(planar, slab);
  return length(max(corner, vec2f(0.0))) + min(max(corner.x, corner.y), 0.0);
}
fn normalAt(point: vec3f, aspect: f32) -> vec3f {
  let e = 0.0025;
  return normalize(vec3f(
    sceneDistance(point + vec3f(e, 0.0, 0.0), aspect) - sceneDistance(point - vec3f(e, 0.0, 0.0), aspect),
    sceneDistance(point + vec3f(0.0, e, 0.0), aspect) - sceneDistance(point - vec3f(0.0, e, 0.0), aspect),
    sceneDistance(point + vec3f(0.0, 0.0, e), aspect) - sceneDistance(point - vec3f(0.0, 0.0, e), aspect)
  ));
}
fn rotateY(point: vec3f, angle: f32) -> vec3f {
  return vec3f(cos(angle) * point.x + sin(angle) * point.z, point.y, -sin(angle) * point.x + cos(angle) * point.z);
}
fn rotateX(point: vec3f, angle: f32) -> vec3f {
  return vec3f(point.x, cos(angle) * point.y - sin(angle) * point.z, sin(angle) * point.y + cos(angle) * point.z);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv);
  let amount = globals.params[12].x;
  if (amount <= 0.0) { return original; }
  let aspect = globals.viewport.x / globals.viewport.y;
  let initialSeed = boundaryAt(input.uv);
  if (initialSeed.z < 0.5) { return mix(original, vec4f(0.0), amount); }
  if (original.a <= globals.params[0].x &&
    length((input.uv - initialSeed.xy) * vec2f(aspect, 1.0)) > globals.params[1].x * 3.0 + 0.02) {
    return mix(original, vec4f(0.0), amount);
  }
  let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, -1.0);
  let yaw = globals.params[4].x;
  let pitch = globals.params[5].x;
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 1.6), -yaw), -pitch);
  let direction = normalize(rotateX(rotateY(vec3f(screen, -1.6), -yaw), -pitch));
  if (direction.z >= -0.01) { return mix(original, vec4f(0.0), amount); }
  let front = globals.params[1].x * (0.65 + globals.params[3].x * 0.5) + 0.006;
  let back = -globals.params[1].x * 0.5 - 0.006;
  let start = max((front - origin.z) / direction.z, 0.0);
  let end = (back - origin.z) / direction.z;
  if (end <= start) { return mix(original, vec4f(0.0), amount); }
  var previousTravel = start;
  var entry = vec3f(0.0);
  var hit = false;
  for (var step = 0u; step < 64u; step += 1u) {
    let travel = mix(start, end, (f32(step) + 1.0) / 64.0);
    let point = origin + direction * travel;
    if (sceneDistance(point, aspect) <= 0.0) {
      var low = previousTravel;
      var high = travel;
      for (var refine = 0u; refine < 6u; refine += 1u) {
        let middle = (low + high) * 0.5;
        if (sceneDistance(origin + direction * middle, aspect) <= 0.0) { high = middle; }
        else { low = middle; }
      }
      entry = origin + direction * high;
      hit = true;
      break;
    }
    previousTravel = travel;
  }
  if (!hit) { return mix(original, vec4f(0.0), amount); }
  let normal = normalAt(entry, aspect);
  let ior = globals.params[6].x;
  var insideDirection = refract(direction, normal, 1.0 / ior);
  if (dot(insideDirection, insideDirection) < 0.0001) { insideDirection = reflect(direction, normal); }
  var exitPoint = entry + insideDirection * 0.006;
  var pathLength = 0.0;
  var escaped = false;
  for (var step = 0u; step < 24u; step += 1u) {
    let distance = sceneDistance(exitPoint, aspect);
    if (distance > 0.002) { escaped = true; break; }
    let advance = clamp(abs(distance) * 0.7, 0.006, 0.04);
    exitPoint += insideDirection * advance;
    pathLength += advance;
    if (pathLength > 1.2) { break; }
  }
  var reflectedInternally = 0.0;
  if (escaped) {
    let exitNormal = normalAt(exitPoint, aspect);
    let outgoing = refract(insideDirection, -exitNormal, ior);
    if (dot(outgoing, outgoing) < 0.0001) {
      reflectedInternally = 1.0;
      insideDirection = reflect(insideDirection, -exitNormal);
      exitPoint += insideDirection * 0.006;
      for (var step = 0u; step < 12u; step += 1u) {
        let distance = sceneDistance(exitPoint, aspect);
        if (distance > 0.002) { break; }
        let advance = clamp(abs(distance) * 0.7, 0.006, 0.04);
        exitPoint += insideDirection * advance;
        pathLength += advance;
      }
    } else {
      exitPoint += outgoing * globals.params[1].x * 0.25;
    }
  }
  let entryUv = worldUv(entry.xy, aspect);
  let seed = boundaryAt(entryUv);
  var surface = sourceAt(entryUv);
  if (surface.a < 0.1 && seed.z > 0.5) { surface = sourceAt(seed.xy); }
  var transmitted = sourceAt(worldUv(exitPoint.xy, aspect));
  if (transmitted.a < 0.01) { transmitted = surface; }
  let tint = globals.params[11];
  let pigment = transmitted.rgb / max(transmitted.a, 0.00001)
    * mix(vec3f(1.0), tint.rgb, tint.a);
  let absorption = exp(-globals.params[8].rgb * globals.params[8].a * pathLength * 8.0);
  let light = normalize(vec3f(globals.params[10].xy, 1.0));
  let view = -direction;
  let reflected = reflect(direction, normal);
  let roughness = globals.params[9].x;
  let sparkle = pow(max(dot(reflected, light), 0.0), mix(120.0, 8.0, roughness));
  let fresnel0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  let fresnel = fresnel0 + (1.0 - fresnel0) * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  let reflection = vec3f(0.3, 0.47, 0.68) * (0.3 + max(dot(reflected, light), 0.0) * 0.7)
    + vec3f(sparkle) * (1.0 - roughness);
  let reflectMix = clamp(fresnel + reflectedInternally * globals.params[7].x, 0.0, 1.0);
  let crystal = mix(pigment * absorption, reflection, reflectMix);
  let coverage = surface.a;
  return mix(original, vec4f(crystal * coverage, coverage), amount);
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

export const SOURCE_CRYSTAL_EFFECT: EffectDefinition = {
  id: "an-native-owned-bn-source-crystal",
  name: "Faceted Source Crystal",
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
    crystalDepth: {
      type: "float",
      label: "Crystal depth",
      default: 0.18,
      min: 0.03,
      max: 0.4,
      step: 0.01,
    },
    facetFrequency: {
      type: "float",
      label: "Facet frequency",
      default: 18,
      min: 3,
      max: 48,
      step: 1,
    },
    facetRise: {
      type: "float",
      label: "Facet rise",
      default: 0.65,
      min: 0,
      max: 1,
      step: 0.01,
    },
    crystalYaw: {
      type: "float",
      label: "Crystal yaw",
      default: 0.2,
      min: -0.8,
      max: 0.8,
      step: 0.01,
    },
    crystalPitch: {
      type: "float",
      label: "Crystal pitch",
      default: -0.12,
      min: -0.8,
      max: 0.8,
      step: 0.01,
    },
    refractiveIndex: {
      type: "float",
      label: "Refractive index",
      default: 1.48,
      min: 1.01,
      max: 2.2,
      step: 0.01,
    },
    internalReflection: {
      type: "float",
      label: "Internal reflection",
      default: 0.75,
      min: 0,
      max: 1,
      step: 0.01,
    },
    crystalAbsorption: {
      type: "color",
      label: "Crystal absorption",
      default: color([0.13, 0.28, 0.52], 0.55),
    },
    crystalRoughness: {
      type: "float",
      label: "Crystal roughness",
      default: 0.16,
      min: 0.02,
      max: 1,
      step: 0.01,
    },
    crystalLight: {
      type: "vec2",
      label: "Crystal light",
      default: [-0.5, 0.6],
      min: -1,
      max: 1,
    },
    crystalTint: {
      type: "color",
      label: "Crystal tint",
      default: color([0.58, 0.86, 1], 0.3),
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.94,
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
      id: "trace-crystal",
      kind: "render",
      wgsl: crystalWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha triangular-facet prism with bounded entry/exit tracing, refraction, and internal reflection.",
  },
};

export const SOURCE_CRYSTAL_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bn-ice-quartz",
    name: "Ice Quartz",
    definitionId: SOURCE_CRYSTAL_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.12,
      crystalDepth: 0.18,
      facetFrequency: 18,
      facetRise: 0.65,
      crystalYaw: 0.2,
      crystalPitch: -0.12,
      refractiveIndex: 1.48,
      internalReflection: 0.75,
      crystalAbsorption: color([0.13, 0.28, 0.52], 0.55),
      crystalRoughness: 0.16,
      crystalLight: [-0.5, 0.6],
      crystalTint: color([0.58, 0.86, 1], 0.3),
      amount: 0.94,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bn-rose-prism",
    name: "Rose Prism",
    definitionId: SOURCE_CRYSTAL_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      crystalDepth: 0.25,
      facetFrequency: 11,
      facetRise: 0.92,
      crystalYaw: -0.3,
      crystalPitch: 0.16,
      refractiveIndex: 1.66,
      internalReflection: 0.92,
      crystalAbsorption: color([0.52, 0.23, 0.35], 0.7),
      crystalRoughness: 0.28,
      crystalLight: [0.38, 0.75],
      crystalTint: color([1, 0.48, 0.62], 0.48),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
