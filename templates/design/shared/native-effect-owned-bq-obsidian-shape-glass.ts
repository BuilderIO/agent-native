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
fn worldUv(point: vec2f, aspect: f32) -> vec2f {
  return point / vec2f(aspect, -1.0) + vec2f(0.5);
}
fn sourceDistance(uv: vec2f, aspect: f32) -> f32 {
  let boundary = boundaryAt(uv);
  if (boundary.z < 0.5) { return 10.0; }
  let distance = length((uv - boundary.xy) * vec2f(aspect, 1.0));
  let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)) && sourceAt(uv).a > globals.params[0].x;
  return select(distance, -distance, inside);
}
fn sceneDistance(point: vec3f, aspect: f32) -> f32 {
  let shape = sourceDistance(worldUv(point.xy, aspect), aspect);
  let slab = abs(point.z) - globals.params[1].x;
  let corner = vec2f(shape, slab);
  return length(max(corner, vec2f(0.0))) + min(max(corner.x, corner.y), 0.0) - globals.params[2].x;
}
fn normalAt(point: vec3f, aspect: f32) -> vec3f {
  let step = 0.0025;
  let dx = sceneDistance(point + vec3f(step, 0.0, 0.0), aspect) - sceneDistance(point - vec3f(step, 0.0, 0.0), aspect);
  let dy = sceneDistance(point + vec3f(0.0, step, 0.0), aspect) - sceneDistance(point - vec3f(0.0, step, 0.0), aspect);
  let dz = sceneDistance(point + vec3f(0.0, 0.0, step), aspect) - sceneDistance(point - vec3f(0.0, 0.0, step), aspect);
  return normalize(vec3f(dx, dy, dz));
}
fn rotateY(point: vec3f, angle: f32) -> vec3f {
  return vec3f(cos(angle) * point.x + sin(angle) * point.z, point.y, -sin(angle) * point.x + cos(angle) * point.z);
}
fn rotateX(point: vec3f, angle: f32) -> vec3f {
  return vec3f(point.x, cos(angle) * point.y - sin(angle) * point.z, sin(angle) * point.y + cos(angle) * point.z);
}
fn studio(direction: vec3f) -> vec3f {
  let upper = smoothstep(-0.4, 0.8, direction.y);
  let stripA = exp(-pow((direction.x + 0.4) * mix(6.0, 1.7, globals.params[6].x), 2.0));
  let stripB = exp(-pow((direction.x - 0.58) * mix(11.0, 2.4, globals.params[6].x), 2.0));
  return (vec3f(0.02, 0.03, 0.05) + vec3f(0.14, 0.18, 0.24) * upper
    + vec3f(1.4, 1.35, 1.48) * stripA * max(direction.y + 0.5, 0.0)
    + vec3f(0.5, 0.7, 1.1) * stripB) * globals.params[8].x;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[14].x;
  if (amount <= 0.0) { return source; }
  let aspect = globals.viewport.x / globals.viewport.y;
  let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, -1.0);
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 2.0), -globals.params[9].x), -globals.params[10].x);
  let direction = normalize(rotateX(rotateY(vec3f(screen, -2.0), -globals.params[9].x), -globals.params[10].x));
  var travel = 0.0;
  var found = false;
  var hit = vec3f(0.0);
  for (var index = 0u; index < 64u; index += 1u) {
    hit = origin + direction * travel;
    let distance = sceneDistance(hit, aspect);
    if (distance < 0.002) { found = true; break; }
    travel += max(distance * 0.7, 0.003);
    if (travel > 4.0) { break; }
  }
  if (!found) { return source * (1.0 - amount); }
  let normal = normalAt(hit, aspect);
  let view = -direction;
  let cosine = clamp(dot(normal, view), 0.0, 1.0);
  let grazing = pow(1.0 - cosine, 2.4);
  let uv = worldUv(hit.xy, aspect);
  let boundary = boundaryAt(uv);
  var surface = sourceAt(uv);
  if (surface.a <= 0.00001 && boundary.z > 0.5) { surface = sourceAt(boundary.xy); }
  let bentUv = uv + normal.xy * globals.params[7].x * globals.clock.z / globals.viewport.xy;
  let refracted = sourceAt(bentUv);
  let straight = mix(surface.rgb / max(surface.a, 0.00001), refracted.rgb / max(refracted.a, 0.00001), 0.38);
  let body = straight * globals.params[11].rgb * (0.22 + cosine * 0.18);
  let flow = sin(hit.x * 19.0 + hit.y * 11.0 + globals.clock.x * globals.params[5].x) * 0.09;
  let phase = globals.params[3].x * (1.0 - cosine * 0.7 + flow);
  let spectrum = 0.5 + 0.5 * cos(vec3f(6.2831853) * (phase / vec3f(0.64, 0.53, 0.45) + vec3f(0.0, 0.09, 0.2)));
  let film = mix(globals.params[12].rgb, globals.params[13].rgb, spectrum) * spectrum;
  let reflected = studio(reflect(direction, normal));
  let fresnel = 0.04 + 0.96 * pow(1.0 - cosine, 5.0);
  let straightMaterial = body + film * globals.params[4].x * grazing + reflected * fresnel;
  let coverage = clamp(surface.a, 0.0, 1.0);
  let material = vec4f(straightMaterial * coverage, coverage);
  return mix(source, material, amount);
}`;

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

export const OBSIDIAN_SHAPE_GLASS_EFFECT: EffectDefinition = {
  id: "an-native-owned-bq-obsidian-shape-glass",
  name: "Obsidian Shape Glass",
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
      label: "Glass depth",
      default: 0.2,
      min: 0.04,
      max: 0.45,
      step: 0.01,
    },
    bevel: {
      type: "float",
      label: "Edge bevel",
      default: 0.015,
      min: 0,
      max: 0.06,
      step: 0.001,
    },
    filmThickness: {
      type: "float",
      label: "Film thickness",
      default: 0.8,
      min: 0.1,
      max: 2,
      step: 0.01,
    },
    filmStrength: {
      type: "float",
      label: "Iridescence",
      default: 1.15,
      min: 0,
      max: 3,
      step: 0.01,
    },
    filmFlow: {
      type: "float",
      label: "Film flow",
      default: 0.3,
      min: 0,
      max: 2,
      step: 0.01,
    },
    roughness: {
      type: "float",
      label: "Roughness",
      default: 0.17,
      min: 0.01,
      max: 1,
      step: 0.01,
    },
    refraction: {
      type: "float",
      label: "Refraction",
      default: 5,
      min: 0,
      max: 16,
      step: 0.1,
    },
    studio: {
      type: "float",
      label: "Studio reflection",
      default: 1.1,
      min: 0,
      max: 3,
      step: 0.01,
    },
    yaw: {
      type: "float",
      label: "Orbit yaw",
      default: 0.22,
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
    bodyTint: {
      type: "color",
      label: "Glass body",
      default: color([0.08, 0.09, 0.17]),
    },
    filmA: {
      type: "color",
      label: "Film color A",
      default: color([0.15, 0.75, 0.96]),
    },
    filmB: {
      type: "color",
      label: "Film color B",
      default: color([0.95, 0.24, 0.66]),
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
      id: "shade-obsidian",
      kind: "render",
      wgsl: glassWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha extruded glass with grazing-angle thin-film interference, dark body transmission and bounded surface raymarching.",
  },
};

export const OBSIDIAN_SHAPE_GLASS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bq-midnight-opal",
    name: "Midnight Opal",
    definitionId: OBSIDIAN_SHAPE_GLASS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      depth: 0.2,
      bevel: 0.015,
      filmThickness: 0.8,
      filmStrength: 1.15,
      filmFlow: 0.3,
      roughness: 0.17,
      refraction: 5,
      studio: 1.1,
      yaw: 0.22,
      pitch: -0.12,
      bodyTint: color([0.08, 0.09, 0.17]),
      filmA: color([0.15, 0.75, 0.96]),
      filmB: color([0.95, 0.24, 0.66]),
      amount: 0.95,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bq-ember-obsidian",
    name: "Ember Obsidian",
    definitionId: OBSIDIAN_SHAPE_GLASS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.06,
      depth: 0.29,
      bevel: 0.034,
      filmThickness: 1.25,
      filmStrength: 1.8,
      filmFlow: 0.14,
      roughness: 0.34,
      refraction: 9,
      studio: 0.75,
      yaw: -0.27,
      pitch: 0.18,
      bodyTint: color([0.12, 0.055, 0.04]),
      filmA: color([0.98, 0.48, 0.12]),
      filmB: color([0.72, 0.12, 0.56]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const OBSIDIAN_SHAPE_GLASS_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  OBSIDIAN_SHAPE_GLASS_PRESETS.map((preset) => [preset.id, preset.id]),
);
