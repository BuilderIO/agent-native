import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const blobWgsl = `${NATIVE_RENDER_GLOBALS}
fn smoothUnion(a: f32, b: f32, radius: f32) -> f32 {
  let blend = clamp(0.5 + 0.5 * (b - a) / max(radius, 0.0001), 0.0, 1.0);
  return mix(b, a, blend) - radius * blend * (1.0 - blend);
}
fn sceneDistance(point: vec3f) -> f32 {
  let time = globals.clock.x * globals.params[4].x;
  let count = globals.params[0].x;
  var distance = 10.0;
  for (var index = 0u; index < 9u; index += 1u) {
    if (f32(index) >= count) { break; }
    let phase = f32(index) * 2.399963;
    let orbit = vec3f(
      cos(phase + time * (0.38 + f32(index % 3u) * 0.09)),
      sin(phase * 1.3 - time * (0.31 + f32(index % 4u) * 0.07)),
      sin(phase * 1.7 + time * 0.43));
    let center = orbit * vec3f(0.22, 0.2, 0.18) * globals.params[3].x;
    let radius = globals.params[1].x * (0.69 + f32(index % 3u) * 0.12);
    let sphere = length(point - center) - radius;
    distance = smoothUnion(distance, sphere, globals.params[2].x);
  }
  return distance;
}
fn normalAt(point: vec3f) -> vec3f {
  let step = 0.0025;
  let dx = sceneDistance(point + vec3f(step, 0.0, 0.0)) - sceneDistance(point - vec3f(step, 0.0, 0.0));
  let dy = sceneDistance(point + vec3f(0.0, step, 0.0)) - sceneDistance(point - vec3f(0.0, step, 0.0));
  let dz = sceneDistance(point + vec3f(0.0, 0.0, step)) - sceneDistance(point - vec3f(0.0, 0.0, step));
  return normalize(vec3f(dx, dy, dz));
}
fn rotateY(point: vec3f, angle: f32) -> vec3f {
  return vec3f(cos(angle) * point.x + sin(angle) * point.z, point.y, -sin(angle) * point.x + cos(angle) * point.z);
}
fn rotateX(point: vec3f, angle: f32) -> vec3f {
  return vec3f(point.x, cos(angle) * point.y - sin(angle) * point.z, sin(angle) * point.y + cos(angle) * point.z);
}
fn over(front: vec4f, back: vec4f) -> vec4f {
  return vec4f(front.rgb + back.rgb * (1.0 - front.a), front.a + back.a * (1.0 - front.a));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let background = globals.params[12];
  let backdrop = vec4f(background.rgb * background.a, background.a);
  let aspect = globals.viewport.x / globals.viewport.y;
  let center = globals.params[14].xy;
  let screen = (input.uv - center) * vec2f(aspect, -1.0);
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 2.0), -globals.params[5].x), -globals.params[6].x);
  let direction = normalize(rotateX(rotateY(vec3f(screen, -2.0), -globals.params[5].x), -globals.params[6].x));
  var travel = 0.0;
  var hit = vec3f(0.0);
  var found = false;
  for (var iteration = 0u; iteration < 64u; iteration += 1u) {
    hit = origin + direction * travel;
    let distance = sceneDistance(hit);
    if (distance < 0.0018) { found = true; break; }
    travel += max(distance * 0.72, 0.002);
    if (travel > 4.0) { break; }
  }
  if (!found) { return backdrop * globals.params[13].x; }
  let normal = normalAt(hit);
  let view = -direction;
  let angle = globals.params[9].x;
  let key = normalize(vec3f(cos(angle) * 0.7, sin(angle) * 0.7, 0.75));
  let fill = normalize(vec3f(-0.65, 0.35, 0.8));
  let diffuse = max(dot(normal, key), 0.0) * 0.72 + max(dot(normal, fill), 0.0) * 0.24;
  let roughness = globals.params[7].x;
  let specular = pow(max(dot(normal, normalize(key + view)), 0.0), mix(128.0, 8.0, roughness));
  let softSpecular = pow(max(dot(normal, normalize(fill + view)), 0.0), mix(28.0, 4.0, roughness));
  let rim = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 2.6) * globals.params[8].x;
  let gradient = clamp(0.5 + hit.y * 1.15 + normal.x * 0.11, 0.0, 1.0);
  let base = mix(globals.params[10].rgb, globals.params[11].rgb, gradient);
  let straight = base * (0.18 + diffuse) + vec3f(specular * 0.6 + softSpecular * 0.19 + rim * 0.42);
  return over(vec4f(straight, 1.0), backdrop) * globals.params[13].x;
}`;

export const LIT_BLOB_EFFECT: EffectDefinition = {
  id: "an-native-owned-bs-lit-blob",
  name: "Lit Blob",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    blobCount: {
      type: "int",
      label: "Lobes",
      default: 7,
      min: 3,
      max: 9,
      step: 1,
    },
    radius: {
      type: "float",
      label: "Body radius",
      default: 0.42,
      min: 0.16,
      max: 0.7,
      step: 0.01,
    },
    merge: {
      type: "float",
      label: "Soft union",
      default: 0.18,
      min: 0.01,
      max: 0.45,
      step: 0.01,
    },
    deformation: {
      type: "float",
      label: "Deformation",
      default: 0.75,
      min: 0,
      max: 1.5,
      step: 0.01,
    },
    speed: {
      type: "float",
      label: "Motion speed",
      default: 0.7,
      min: 0,
      max: 2.5,
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
      default: -0.1,
      min: -0.8,
      max: 0.8,
      step: 0.01,
    },
    roughness: {
      type: "float",
      label: "Roughness",
      default: 0.28,
      min: 0.02,
      max: 1,
      step: 0.01,
    },
    rim: {
      type: "float",
      label: "Rim light",
      default: 0.72,
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
    colorA: {
      type: "color",
      label: "Shadow color",
      default: color([0.16, 0.27, 0.83]),
    },
    colorB: {
      type: "color",
      label: "Lit color",
      default: color([0.86, 0.43, 0.76]),
    },
    background: {
      type: "color",
      label: "Background",
      default: color([0.025, 0.035, 0.08], 0),
    },
    opacity: {
      type: "float",
      label: "Opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    center: {
      type: "vec2",
      label: "Center",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "raymarch-lit-blob",
      kind: "render",
      reads: [],
      output: "color",
      wgsl: blobWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded 3D smooth-union organic body with finite-difference normals, two studio lights, roughness and rim shading.",
  },
};

export const LIT_BLOB_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bs-orchid-glass",
    name: "Orchid Glass",
    definitionId: LIT_BLOB_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      blobCount: 7,
      radius: 0.42,
      merge: 0.18,
      deformation: 0.75,
      speed: 0.7,
      yaw: 0.2,
      pitch: -0.1,
      roughness: 0.22,
      rim: 1.1,
      lightAngle: -0.65,
      colorA: color([0.16, 0.27, 0.83]),
      colorB: color([0.86, 0.43, 0.76]),
      background: color([0.025, 0.035, 0.08], 0),
      opacity: 1,
      center: [0.5, 0.5],
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bs-amber-pearl",
    name: "Amber Pearl",
    definitionId: LIT_BLOB_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      blobCount: 5,
      radius: 0.5,
      merge: 0.28,
      deformation: 0.38,
      speed: 0.28,
      yaw: -0.25,
      pitch: 0.18,
      roughness: 0.48,
      rim: 0.55,
      lightAngle: 0.8,
      colorA: color([0.45, 0.12, 0.055]),
      colorB: color([1, 0.77, 0.43]),
      background: color([0.12, 0.055, 0.025]),
      opacity: 0.95,
      center: [0.48, 0.54],
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const LIT_BLOB_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  LIT_BLOB_PRESETS.map((preset) => [preset.id, preset.id]),
);
