import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const fluidComputeWgsl = `
struct Params {
  time: f32, dt: f32, seed: f32, emission: f32,
  diffusion: f32, buoyancy: f32, curl: f32, padding: f32,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;
fn cellAt(cell: vec2i) -> vec2i { return clamp(cell, vec2i(0), vec2i(255)); }
fn priorAt(cell: vec2i) -> vec4f { return textureLoad(priorTexture, cellAt(cell), 0); }
fn sourceAt(cell: vec2i) -> vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let coordinate = vec2i(clamp(floor((vec2f(cellAt(cell)) + 0.5) * size / 256.0), vec2f(0.0), size - 1.0));
  return textureLoad(sourceTexture, coordinate, 0);
}
fn advected(position: vec2f) -> vec4f {
  let point = clamp(position, vec2f(0.0), vec2f(255.0));
  let low = vec2i(floor(point));
  let fraction = fract(point);
  return mix(mix(priorAt(low), priorAt(low + vec2i(1, 0)), fraction.x),
    mix(priorAt(low + vec2i(0, 1)), priorAt(low + vec2i(1, 1)), fraction.x), fraction.y);
}
fn stepState(cell: vec2i) -> vec4f {
  let center = priorAt(cell);
  let left = priorAt(cell + vec2i(-1, 0));
  let right = priorAt(cell + vec2i(1, 0));
  let up = priorAt(cell + vec2i(0, -1));
  let down = priorAt(cell + vec2i(0, 1));
  let backtrace = vec2f(cell) - center.rg * params.dt;
  let carried = advected(backtrace);
  let laplacian = (left + right + up + down) * 0.25 - center;
  let source = sourceAt(cell);
  let sourceLight = dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let injection = source.a * (0.25 + sourceLight * 0.75) * params.emission;
  let gradient = vec2f(right.b - left.b, down.b - up.b) * 0.5;
  let vorticity = (right.g - left.g - down.r + up.r) * 0.5;
  let swirl = vec2f(-gradient.y, gradient.x) * vorticity * params.curl;
  let seedAngle = fract(sin(dot(vec2f(cell), vec2f(12.9898, 78.233)) + params.seed * 17.17) * 43758.5453) * 6.2831853;
  let sourceEddy = vec2f(cos(seedAngle), sin(seedAngle)) * injection * 9.0;
  let spread = (params.diffusion - 30.0) / 120.0;
  let velocity = carried.rg * 0.992 + laplacian.rg * spread * 0.16
    + (vec2f(0.0, -carried.a * params.buoyancy * 16.0) + swirl * 8.0 + sourceEddy) * params.dt;
  let density = clamp(carried.b * 0.994 + laplacian.b * spread * 0.2 + injection * params.dt * 2.4, 0.0, 1.0);
  let heat = clamp(carried.a * 0.989 + laplacian.a * spread * 0.16 + injection * params.dt * 1.8, 0.0, 1.0);
  return vec4f(clamp(velocity, vec2f(-18.0), vec2f(18.0)), density, heat);
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 256u || invocation.y >= 256u) { return; }
  let cell = vec2i(invocation.xy);
  let source = sourceAt(cell);
  let sourceLight = dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722));
  var next = priorAt(cell);
  if (params.dt <= 0.0 && params.time <= 0.0) {
    let initial = source.a * (0.25 + sourceLight * 0.75) * params.emission * 0.14;
    next = vec4f(0.0, 0.0, initial, initial);
  } else if (params.dt > 0.0) {
    next = stepState(cell);
  }
  textureStore(nextTexture, cell, next);
  let tint = mix(vec3f(0.22, 0.26, 0.31), source.rgb / max(source.a, 0.00001), source.a * 0.72);
  let alpha = clamp(next.b * 0.86 + next.a * 0.1, 0.0, 1.0);
  textureStore(displayTexture, cell, vec4f(tint * alpha, alpha));
}
`;

const fluidResolveWgsl = `
struct Resolve { blend: f32, padding: vec3f };
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var displayTexture: texture_2d<f32>;
@group(0) @binding(2) var linearClamp: sampler;
@group(0) @binding(3) var<uniform> resolve: Resolve;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let xy = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var output: VertexOut;
  output.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(xy.x, 1.0 - xy.y);
  return output;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, linearClamp, input.uv, 0.0);
  let smoke = textureSampleLevel(displayTexture, linearClamp, input.uv, 0.0);
  let veil = smoke * resolve.blend;
  return veil + source * (1.0 - veil.a);
}
`;

const float = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});

const fluid: EffectDefinition = {
  id: "an-native-owned-ai-source-smoke-fluid",
  name: "Source Smoke Fluid",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    emission: float("Emission", 0.85, 0, 1),
    diffusion: float("Diffusion length", 76, 30, 150),
    buoyancy: float("Buoyancy", 0.72, 0, 1),
    curl: float("Curl", 0.7, 0, 1),
    opacity: float("Opacity", 0.8, 0, 1),
    patternSeed: float("Pattern seed", 17, 0, 100),
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
      size: "viewport",
    },
    {
      name: "state",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      persistent: true,
      size: "fixed",
      width: 256,
      height: 256,
    },
    {
      name: "display",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      size: "fixed",
      width: 256,
      height: 256,
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  output: "color",
  feedback: {
    abi: "texture-feedback-v1",
    sourceHistory: "sequential-captures",
    grid: { width: 256, height: 256, format: "rgba16float", workgroup: [8, 8] },
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 512, maxStepIndex: 36000 },
    stateResource: "state",
    displayResource: "display",
    uniformProperties: {
      intensity: "emission",
      blockSize: "diffusion",
      drift: "buoyancy",
      churn: "curl",
      blend: "opacity",
      seed: "patternSeed",
    },
    resetProperties: ["patternSeed"],
  },
  passes: [
    {
      id: "advance",
      kind: "compute",
      reads: ["source"],
      previousFrameReads: ["state"],
      output: "state",
      additionalOutputs: ["display"],
      persistent: true,
      dispatch: { workgroupSize: [8, 8], elements: "fixed-grid" },
      wgsl: fluidComputeWgsl,
    },
    {
      id: "resolve",
      kind: "render",
      reads: ["source", "display"],
      output: "color",
      wgsl: fluidResolveWgsl,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original fixed-grid smoke transport: source pixels emit density, and persistent velocity advects, diffuses, rises, and curls the plume.",
  },
};

const satinWgsl = `${NATIVE_RENDER_GLOBALS}
fn folds(q: vec2f, count: f32, drape: f32, phase: f32) -> f32 {
  let broad = sin(q.x * count + sin(q.y * 4.1 + phase * 0.36) * drape + phase * 0.24) * 0.13;
  let secondary = sin(q.x * count * 1.8 - q.y * 3.3 + phase * 0.27) * 0.035;
  let sag = pow(abs(q.x - 0.5), 2.0) * drape * 0.22;
  return broad + secondary - sag;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let angle = globals.params[0].x;
  let centered = uv - vec2f(0.5);
  let q = vec2f(centered.x * cos(angle) - centered.y * sin(angle),
    centered.x * sin(angle) + centered.y * cos(angle)) + vec2f(0.5);
  let count = globals.params[1].x;
  let drape = globals.params[2].x;
  let phase = globals.clock.x * globals.params[3].x;
  let height = folds(q, count, drape, phase);
  let step = max(globals.viewport.z, globals.viewport.w) * 1.5;
  let dx = (folds(q + vec2f(step, 0.0), count, drape, phase) - folds(q - vec2f(step, 0.0), count, drape, phase)) / (2.0 * step);
  let dy = (folds(q + vec2f(0.0, step), count, drape, phase) - folds(q - vec2f(0.0, step), count, drape, phase)) / (2.0 * step);
  let normal = normalize(vec3f(-dx * 0.38, -dy * 0.38, 1.0));
  let thread = 0.5 + 0.5 * sin(q.x * globals.params[6].x * 180.0 + height * 12.0);
  let light = normalize(vec3f(0.64, -0.36, 0.68));
  let view = vec3f(0.0, 0.0, 1.0);
  let halfVector = normalize(light + view);
  let tangent = normalize(vec3f(-sin(angle), cos(angle), 0.0));
  let anisotropic = pow(max(dot(normal, halfVector), 0.0), 18.0 + globals.params[5].x * 90.0)
    * pow(1.0 - abs(dot(tangent, halfVector)), 2.0);
  let diffuse = 0.24 + 0.68 * max(dot(normal, light), 0.0);
  let sheen = anisotropic * globals.params[4].x * (0.76 + thread * 0.24);
  let base = globals.params[7].rgb * diffuse;
  let highlight = globals.params[8].rgb * sheen * globals.params[8].a;
  let alpha = globals.params[7].a;
  return vec4f((base + highlight) * alpha, alpha);
}
`;

const satin: EffectDefinition = {
  id: "an-native-owned-ai-satin-folds",
  name: "Satin Folds",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    direction: float("Fold direction", 0.12, -3.14, 3.14),
    foldCount: float("Fold count", 13, 3, 32),
    drape: float("Drape", 0.6, 0, 1.5),
    motion: float("Fold motion", 0.3, 0, 2),
    sheen: float("Sheen", 0.85, 0, 2),
    focus: float("Sheen focus", 0.55, 0, 1),
    weave: float("Weave", 0.45, 0, 1),
    clothColor: {
      type: "color",
      label: "Cloth color",
      default: { space: "srgb", components: [0.45, 0.22, 0.38], alpha: 1 },
    },
    sheenColor: {
      type: "color",
      label: "Sheen color",
      default: { space: "srgb", components: [0.97, 0.78, 0.83], alpha: 1 },
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  passes: [
    {
      id: "render",
      kind: "render",
      reads: [],
      output: "color",
      wgsl: satinWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original animated cloth surface: moving draped fold height yields normals, directional satin sheen, and fine weave modulation.",
  },
};

export const AI_FLUID_CLOTH_DEFINITIONS: readonly EffectDefinition[] = [
  fluid,
  satin,
];

export const AI_FLUID_CLOTH_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-ai-smoke-column",
    name: "Smoke Column",
    definitionId: fluid.id,
    definitionVersion: 1,
    placement: "layer",
    clip: "bounds",
    params: {
      emission: 0.95,
      diffusion: 67,
      buoyancy: 0.95,
      curl: 0.72,
      opacity: 0.86,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ai-smoke-drift",
    name: "Slow Drift",
    definitionId: fluid.id,
    definitionVersion: 1,
    placement: "backdrop",
    clip: "bounds",
    params: {
      emission: 0.48,
      diffusion: 126,
      buoyancy: 0.18,
      curl: 0.94,
      opacity: 0.62,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ai-satin-rose",
    name: "Rose Satin",
    definitionId: satin.id,
    definitionVersion: 1,
    placement: "fill",
    clip: "bounds",
    params: {
      direction: 0.12,
      foldCount: 13,
      drape: 0.6,
      motion: 0.34,
      sheen: 0.85,
      focus: 0.55,
      weave: 0.45,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ai-satin-silver",
    name: "Silver Satin",
    definitionId: satin.id,
    definitionVersion: 1,
    placement: "fill",
    clip: "bounds",
    params: {
      direction: -0.48,
      foldCount: 21,
      drape: 0.34,
      motion: 0.12,
      sheen: 1.35,
      focus: 0.79,
      weave: 0.3,
      clothColor: { space: "srgb", components: [0.29, 0.36, 0.44], alpha: 1 },
      sheenColor: { space: "srgb", components: [0.94, 0.97, 1], alpha: 1 },
    },
    provenance: { origin: "design-original" },
  },
];

export const AI_FLUID_CLOTH_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  AI_FLUID_CLOTH_PRESETS.map((preset) => [preset.id, preset.id]),
);
