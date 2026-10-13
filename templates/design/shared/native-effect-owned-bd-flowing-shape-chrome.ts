import {
  SOURCE_SHAPE_BOUNDARY_SEED_WGSL,
  SOURCE_SHAPE_FIELD_SIZE,
  SOURCE_SHAPE_JUMP_STEPS,
  sourceShapeJumpFloodWgsl,
} from "./native-effect-owned-bc-shape-goo";
import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const chromeRenderWgsl = `${NATIVE_GRAPH_GLOBALS}
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
fn foldAt(point: vec2f) -> f32 {
  let frequency = globals.params[2].x;
  let time = globals.clock.x * globals.params[4].x;
  let primary = sin(point.x * frequency + time * 1.1)
    * cos(point.y * frequency * 0.83 - time * 0.74);
  let diagonal = sin((point.x + point.y * 0.7) * frequency * 1.37 - time * 0.51);
  return primary * 0.67 + diagonal * 0.33;
}
fn sceneDistance(point: vec3f, aspect: f32) -> f32 {
  let uv = worldUv(point.xy, aspect);
  let sourceShape = sourceDistance(uv, aspect);
  if (sourceShape > 1.0) { return sourceShape; }
  let fold = foldAt(point.xy) * globals.params[3].x;
  let contour = sourceShape + fold * 0.42;
  let height = globals.params[1].x + fold * 0.8;
  let slab = abs(point.z) - max(height, 0.015);
  let corner = vec2f(contour, slab);
  return length(max(corner, vec2f(0.0))) + min(max(corner.x, corner.y), 0.0);
}
fn normalAt(point: vec3f, aspect: f32) -> vec3f {
  let step = 0.003;
  let dx = sceneDistance(point + vec3f(step, 0.0, 0.0), aspect)
    - sceneDistance(point - vec3f(step, 0.0, 0.0), aspect);
  let dy = sceneDistance(point + vec3f(0.0, step, 0.0), aspect)
    - sceneDistance(point - vec3f(0.0, step, 0.0), aspect);
  let dz = sceneDistance(point + vec3f(0.0, 0.0, step), aspect)
    - sceneDistance(point - vec3f(0.0, 0.0, step), aspect);
  return normalize(vec3f(dx, dy, dz));
}
fn rotateY(point: vec3f, angle: f32) -> vec3f {
  return vec3f(cos(angle) * point.x + sin(angle) * point.z, point.y, -sin(angle) * point.x + cos(angle) * point.z);
}
fn rotateX(point: vec3f, angle: f32) -> vec3f {
  return vec3f(point.x, cos(angle) * point.y - sin(angle) * point.z, sin(angle) * point.y + cos(angle) * point.z);
}
fn studio(direction: vec3f) -> vec3f {
  let angle = globals.params[11].x;
  let rotated = vec3f(
    direction.x * cos(angle) - direction.y * sin(angle),
    direction.x * sin(angle) + direction.y * cos(angle), direction.z
  );
  let upper = smoothstep(-0.25, 0.85, rotated.y);
  let strip = exp(-pow((rotated.x + 0.34) * 3.2, 2.0))
    * smoothstep(-0.45, 0.1, rotated.y);
  let card = exp(-pow((rotated.x - 0.55) * 5.0, 2.0))
    * smoothstep(-0.55, 0.4, rotated.y);
  let rim = pow(max(rotated.z, 0.0), 8.0);
  return (mix(vec3f(0.025, 0.038, 0.06), vec3f(0.22, 0.27, 0.34), upper)
    + vec3f(1.8, 1.75, 1.65) * strip
    + vec3f(0.74, 0.89, 1.06) * card
    + vec3f(0.18) * rim) * globals.params[12].x;
}
fn roughReflection(direction: vec3f, roughness: f32) -> vec3f {
  let sharp = studio(direction);
  let blur = (studio(normalize(direction + vec3f(roughness, 0.0, 0.0)))
    + studio(normalize(direction - vec3f(roughness, 0.0, 0.0)))
    + studio(normalize(direction + vec3f(0.0, roughness, 0.0)))
    + studio(normalize(direction - vec3f(0.0, roughness, 0.0)))) * 0.25;
  return mix(sharp, blur, roughness);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = sourceAt(input.uv);
  let amount = globals.params[14].x;
  if (amount <= 0.0) { return source; }
  let aspect = globals.viewport.x / globals.viewport.y;
  let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, -1.0);
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 2.0), -globals.params[5].x), -globals.params[6].x);
  let direction = normalize(rotateX(rotateY(vec3f(screen, -2.0), -globals.params[5].x), -globals.params[6].x));
  var travel = 0.0;
  var found = false;
  var hit = vec3f(0.0);
  for (var step = 0u; step < 64u; step += 1u) {
    hit = origin + direction * travel;
    let distance = sceneDistance(hit, aspect);
    if (distance < 0.002) { found = true; break; }
    travel += max(distance * 0.7, 0.003);
    if (travel > 4.0) { break; }
  }
  if (!found) { return source; }

  let normal = normalAt(hit, aspect);
  let view = -direction;
  let reflected = reflect(direction, normal);
  let roughness = globals.params[8].x;
  let metal = globals.params[7].x;
  let environment = roughReflection(reflected, roughness);
  let uv = worldUv(hit.xy, aspect);
  let seed = boundaryAt(uv);
  var surface = sourceAt(uv);
  if (surface.a < 0.1 && seed.z > 0.5) { surface = sourceAt(seed.xy); }
  let tint = globals.params[13];
  let pigment = (surface.rgb / max(surface.a, 0.00001))
    * mix(vec3f(1.0), tint.rgb, tint.a);
  let shift = normal.xy * globals.params[9].x * globals.clock.z / globals.viewport.xy;
  let chroma = normal.xy * globals.params[10].x * globals.clock.z / globals.viewport.xy;
  let middle = sourceAt(uv + shift);
  let red = sourceAt(uv + shift + chroma);
  let blue = sourceAt(uv + shift - chroma);
  let transmitted = vec3f(red.r / max(red.a, 0.00001),
    middle.g / max(middle.a, 0.00001), blue.b / max(blue.a, 0.00001));
  let transmission = mix(pigment, transmitted, (1.0 - metal) * middle.a);
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  let chrome = environment * mix(vec3f(fresnel), pigment * 0.65 + vec3f(fresnel), metal);
  let shaded = mix(transmission, chrome, metal * 0.8 + fresnel * 0.2);
  let coverage = clamp(surface.a, 0.0, 1.0);
  let material = vec4f(shaded * coverage, coverage);
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

const color = (components: [number, number, number], alpha: number) => ({
  space: "srgb" as const,
  components,
  alpha,
});

export const FLOWING_SHAPE_CHROME_EFFECT: EffectDefinition = {
  id: "an-native-owned-bd-flowing-shape-chrome",
  name: "Flowing Shape Chrome",
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
      default: 0.14,
      min: 0.04,
      max: 0.35,
      step: 0.01,
    },
    foldFrequency: {
      type: "float",
      label: "Fold frequency",
      default: 16,
      min: 3,
      max: 35,
      step: 0.5,
    },
    foldStrength: {
      type: "float",
      label: "Fold strength",
      default: 0.045,
      min: 0,
      max: 0.12,
      step: 0.005,
    },
    motionSpeed: {
      type: "float",
      label: "Motion speed",
      default: 0.8,
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
      default: -0.1,
      min: -0.8,
      max: 0.8,
      step: 0.01,
    },
    metalness: {
      type: "float",
      label: "Metalness",
      default: 0.82,
      min: 0,
      max: 1,
      step: 0.01,
    },
    roughness: {
      type: "float",
      label: "Roughness",
      default: 0.22,
      min: 0.03,
      max: 1,
      step: 0.01,
    },
    refraction: {
      type: "float",
      label: "Refraction",
      default: 5,
      min: 0,
      max: 30,
      step: 0.5,
      unit: "px",
    },
    dispersion: {
      type: "float",
      label: "Dispersion",
      default: 1.4,
      min: 0,
      max: 8,
      step: 0.1,
      unit: "px",
    },
    studioRotation: {
      type: "float",
      label: "Studio rotation",
      default: 0.2,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    studioIntensity: {
      type: "float",
      label: "Studio intensity",
      default: 1.1,
      min: 0,
      max: 3,
      step: 0.01,
    },
    tint: {
      type: "color",
      label: "Surface tint",
      default: color([0.62, 0.82, 1], 0.36),
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
      id: "shade-chrome",
      kind: "render",
      wgsl: chromeRenderWgsl,
      reads: ["source", "nearest"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original source-alpha signed-distance extrusion with animated geometric folds and procedural studio chrome reflection.",
  },
};

export const FLOWING_SHAPE_CHROME_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bd-silver-current",
    name: "Silver Current",
    definitionId: FLOWING_SHAPE_CHROME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.12,
      depth: 0.14,
      foldFrequency: 15,
      foldStrength: 0.045,
      motionSpeed: 0.85,
      yaw: 0.2,
      pitch: -0.1,
      metalness: 0.9,
      roughness: 0.2,
      refraction: 4,
      dispersion: 0.8,
      studioRotation: 0.2,
      studioIntensity: 1.25,
      tint: color([0.62, 0.82, 1], 0.36),
      amount: 0.92,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bd-rose-chrome",
    name: "Rose Chrome",
    definitionId: FLOWING_SHAPE_CHROME_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      alphaThreshold: 0.08,
      depth: 0.22,
      foldFrequency: 22,
      foldStrength: 0.07,
      motionSpeed: 0.48,
      yaw: -0.26,
      pitch: 0.16,
      metalness: 0.72,
      roughness: 0.36,
      refraction: 12,
      dispersion: 3.2,
      studioRotation: -0.6,
      studioIntensity: 0.85,
      tint: color([1, 0.43, 0.51], 0.65),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const FLOWING_SHAPE_CHROME_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  FLOWING_SHAPE_CHROME_PRESETS.map((preset) => [preset.id, preset.id]),
);
