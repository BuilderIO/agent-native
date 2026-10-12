import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeWgsl = `
struct Params {
  time: f32, dt: f32, seed: f32, viscosity: f32,
  brushRadius: f32, diffusion: f32, stirring: f32, sourcePixelRatio: f32,
};
struct PointerUniform { motion: vec4f, status: vec4f };
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<uniform> pointer: PointerUniform;
fn sourceAt(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let coordinate = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(0.99999)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return textureLoad(sourceTexture, coordinate, 0);
}
fn stateAt(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(priorTexture));
  let coordinate = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(0.99999)) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return textureLoad(priorTexture, coordinate, 0);
}
fn hash(value: u32) -> f32 {
  var x = value * 1664525u + u32(params.seed) * 747796405u + 1013904223u;
  x = ((x >> 16u) ^ x) * 2246822519u;
  return f32((x >> 8u) & 16777215u) / 16777216.0;
}
fn update(cell: vec2i) -> vec4f {
  let dimensions = vec2f(textureDimensions(priorTexture));
  let uv = (vec2f(cell) + 0.5) / dimensions;
  let source = sourceAt(uv);
  if (source.a <= 0.04) { return vec4f(0.0); }
  let old = textureLoad(priorTexture, cell, 0);
  let pixel = 1.0 / dimensions;
  var backtrace = uv - old.xy * params.dt;
  if (sourceAt(backtrace).a <= 0.04) { backtrace = uv; }
  let advected = stateAt(backtrace);
  let left = stateAt(uv - vec2f(pixel.x, 0.0));
  let right = stateAt(uv + vec2f(pixel.x, 0.0));
  let top = stateAt(uv - vec2f(0.0, pixel.y));
  let bottom = stateAt(uv + vec2f(0.0, pixel.y));
  let average = (left + right + top + bottom) * 0.25;
  var velocity = mix(advected.xy, average.xy, clamp(params.viscosity * params.dt * 8.0, 0.0, 1.0));
  velocity *= exp(-params.viscosity * params.dt * 1.5);
  var density = mix(advected.z, average.z, clamp(params.diffusion * params.dt * 12.0, 0.0, 1.0));
  density *= exp(-params.diffusion * params.dt * 0.12);
  var pigment = advected.w;
  if (pointer.status.x > 0.5) {
    let sourceSize = vec2f(textureDimensions(sourceTexture));
    let displacement = (uv - pointer.motion.xy) * sourceSize;
    let radius = max(1.0, params.brushRadius * params.sourcePixelRatio);
    let brush = exp(-dot(displacement, displacement) / (radius * radius)) * source.a;
    let cursorVelocity = clamp(pointer.motion.zw * 24.0, vec2f(-1.2), vec2f(1.2));
    velocity += cursorVelocity * brush * params.stirring * params.dt * 6.0;
    let grain = 0.8 + 0.2 * hash(u32(cell.x + cell.y * 256) ^ u32(params.time * 60.0));
    density = clamp(density + brush * grain * params.dt * 4.0, 0.0, 1.0);
    let sourceLight = dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722)) / max(source.a, 0.0001);
    pigment = mix(pigment, sourceLight, clamp(brush * params.dt * 6.0, 0.0, 1.0));
  }
  var normal = vec2f(
    sourceAt(uv + vec2f(pixel.x, 0.0)).a - sourceAt(uv - vec2f(pixel.x, 0.0)).a,
    sourceAt(uv + vec2f(0.0, pixel.y)).a - sourceAt(uv - vec2f(0.0, pixel.y)).a
  );
  let normalLength = length(normal);
  if (normalLength > 0.001) {
    normal /= normalLength;
    velocity -= normal * min(dot(velocity, normal), 0.0);
  }
  return vec4f(clamp(velocity, vec2f(-1.5), vec2f(1.5)), density, clamp(pigment, 0.0, 1.0));
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 256u || invocation.y >= 256u) { return; }
  let cell = vec2i(invocation.xy);
  let next = update(cell);
  textureStore(nextTexture, cell, next);
  textureStore(displayTexture, cell, next);
}
`;

const resolveWgsl = `
struct Resolve { amount: f32, padding: vec3f };
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
  if (resolve.amount <= 0.0 || source.a <= 0.04) { return source; }
  let fluid = textureSampleLevel(displayTexture, linearClamp, input.uv, 0.0);
  let transportedUv = clamp(input.uv - fluid.xy * 0.045, vec2f(0.0), vec2f(1.0));
  let transported = textureSampleLevel(sourceTexture, linearClamp, transportedUv, 0.0);
  let density = clamp(fluid.z, 0.0, 1.0);
  let mixture = resolve.amount * density * source.a;
  let tint = 0.7 + 0.6 * fluid.w;
  let ink = vec4f(transported.rgb * tint * source.a / max(transported.a, 0.0001), source.a);
  return mix(source, ink, mixture);
}
`;

export const SOURCE_SHAPE_FLUID_EFFECT: EffectDefinition = {
  id: "an-native-source-shape-fluid",
  name: "Source Shape Fluid",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    viscosity: {
      type: "float",
      label: "Viscosity",
      default: 0.45,
      min: 0,
      max: 1,
      step: 0.01,
    },
    brushRadius: {
      type: "float",
      label: "Brush radius",
      default: 85,
      min: 30,
      max: 150,
      step: 1,
      unit: "px",
    },
    diffusion: {
      type: "float",
      label: "Diffusion",
      default: 0.18,
      min: 0,
      max: 1,
      step: 0.01,
    },
    stirring: {
      type: "float",
      label: "Stirring",
      default: 0.72,
      min: 0,
      max: 1,
      step: 0.01,
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.01,
    },
    patternSeed: {
      type: "float",
      label: "Pattern seed",
      default: 27,
      min: 0,
      max: 100,
      step: 1,
    },
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: false },
  },
  interaction: {
    positionProperty: "pointerPosition",
    activeProperty: "pointerActive",
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
    pointer: "interaction-v1",
    grid: { width: 256, height: 256, format: "rgba16float", workgroup: [8, 8] },
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 512, maxStepIndex: 36_000 },
    stateResource: "state",
    displayResource: "display",
    uniformProperties: {
      intensity: "viscosity",
      blockSize: "brushRadius",
      drift: "diffusion",
      churn: "stirring",
      blend: "amount",
      seed: "patternSeed",
    },
    resetProperties: ["patternSeed"],
  },
  passes: [
    {
      id: "advance",
      kind: "compute",
      wgsl: computeWgsl,
      reads: ["source"],
      previousFrameReads: ["state"],
      output: "state",
      additionalOutputs: ["display"],
      persistent: true,
      dispatch: { workgroupSize: [8, 8], elements: "fixed-grid" },
    },
    {
      id: "resolve",
      kind: "render",
      wgsl: resolveWgsl,
      reads: ["source", "display"],
      output: "color",
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original alpha-bounded fluid with retained velocity/density advection, cursor paint, and no-flux source boundaries.",
  },
};

export const SOURCE_SHAPE_FLUID_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-source-shape-fluid-ink",
    name: "Ink Current",
    definitionId: SOURCE_SHAPE_FLUID_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      viscosity: 0.62,
      brushRadius: 72,
      diffusion: 0.08,
      stirring: 0.9,
      amount: 0.95,
      pointerActive: false,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-source-shape-fluid-mist",
    name: "Soft Mist",
    definitionId: SOURCE_SHAPE_FLUID_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      viscosity: 0.2,
      brushRadius: 135,
      diffusion: 0.75,
      stirring: 0.35,
      amount: 0.7,
      patternSeed: 61,
      pointerActive: false,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
