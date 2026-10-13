import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const reactionStepWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var previousField: texture_2d<f32>;
@group(0) @binding(18) var nextField: texture_storage_2d<rgba16float, write>;
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn noise(point: vec2u, seed: u32) -> f32 {
  var value = point.x * 1664525u + point.y * 1013904223u + seed * 747796405u;
  value = ((value >> 16u) ^ value) * 2246822519u;
  return f32((value >> 8u) & 16777215u) / 16777216.0;
}
fn fieldAt(point: vec2i, extent: vec2i) -> vec2f {
  let bounded = clamp(point, vec2i(0), extent - vec2i(1));
  let uv = (vec2f(bounded) + 0.5) / vec2f(extent);
  if (sourceAt(uv).a <= 0.01) { return vec2f(1.0, 0.0); }
  return textureLoad(previousField, bounded, 0).xy;
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let extent = vec2i(textureDimensions(nextField));
  if (any(invocation.xy >= vec2u(extent))) { return; }
  let point = vec2i(invocation.xy);
  let uv = (vec2f(point) + 0.5) / vec2f(extent);
  let source = sourceAt(uv);
  if (source.a <= 0.01) {
    textureStore(nextField, point, vec4f(1.0, 0.0, 0.0, 0.0));
    return;
  }
  let previous = textureLoad(previousField, point, 0);
  let center = previous.xy;
  if (previous.z < 0.5) {
    let density = globals.params[7].x;
    let scattered = noise(invocation.xy, u32(globals.params[16].x));
    let straight = source.rgb / max(source.a, 0.00001);
    let brightness = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
    let localDensity = clamp(density * (0.45 + brightness), 0.0, 0.5);
    let reagent = select(0.0, 0.65, scattered < localDensity);
    textureStore(nextField, point, vec4f(1.0 - reagent * 0.45, reagent, 1.0, 0.0));
    return;
  }
  if (globals.clock.w <= 0.0) {
    textureStore(nextField, point, vec4f(center, 1.0, 0.0));
    return;
  }
  let north = fieldAt(point + vec2i(0, -1), extent);
  let south = fieldAt(point + vec2i(0, 1), extent);
  let west = fieldAt(point + vec2i(-1, 0), extent);
  let east = fieldAt(point + vec2i(1, 0), extent);
  let diagonal = (
    fieldAt(point + vec2i(-1, -1), extent) +
    fieldAt(point + vec2i(1, -1), extent) +
    fieldAt(point + vec2i(-1, 1), extent) +
    fieldAt(point + vec2i(1, 1), extent)
  );
  let laplacian = (north + south + west + east) * 0.2 + diagonal * 0.05 - center;
  let straight = source.rgb / max(source.a, 0.00001);
  let brightness = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  let guide = clamp((brightness - globals.params[6].x) * 2.0, -1.0, 1.0) *
    globals.params[5].x * source.a;
  let feed = clamp(globals.params[0].x + guide * 0.018, 0.005, 0.12);
  let kill = clamp(globals.params[1].x - guide * 0.009, 0.02, 0.095);
  let reaction = center.x * center.y * center.y;
  let step = min(globals.clock.w * 60.0 * globals.params[4].x, 1.0);
  var next = center + vec2f(
    globals.params[2].x * laplacian.x - reaction + feed * (1.0 - center.x),
    globals.params[3].x * laplacian.y + reaction - (feed + kill) * center.y
  ) * step;
  if (globals.params[11].x > 0.5) {
    let distance = (uv - globals.params[10].xy) * globals.viewport.xy / max(globals.clock.z, 0.00001);
    let radius = max(globals.params[8].x, 1.0);
    let brush = exp(-dot(distance, distance) / (radius * radius * 0.35));
    next.y += brush * globals.params[9].x * step * 0.22;
    next.x -= brush * globals.params[9].x * step * 0.08;
  }
  textureStore(nextField, point, vec4f(clamp(next, vec2f(0.0), vec2f(1.0)), 1.0, 0.0));
}`;

const reactionPaintWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var reactionField: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(corners[index], 0.0, 1.0);
  output.uv = corners[index] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
fn reagentAt(uv: vec2f) -> f32 {
  return textureSampleLevel(reactionField, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).y;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[12].x;
  if (amount <= 0.0 || source.a <= 0.00001) { return source; }
  let reagent = reagentAt(input.uv);
  let edge = vec2f(1.0) / vec2f(textureDimensions(reactionField));
  let gradient = vec2f(
    reagentAt(input.uv + vec2f(edge.x, 0.0)) - reagentAt(input.uv - vec2f(edge.x, 0.0)),
    reagentAt(input.uv + vec2f(0.0, edge.y)) - reagentAt(input.uv - vec2f(0.0, edge.y))
  );
  let relief = clamp(0.75 + dot(gradient, normalize(vec2f(-0.6, -0.8))) *
    globals.params[15].x * 4.0, 0.2, 1.6);
  let bands = smoothstep(0.055, 0.45, reagent);
  let pigment = mix(globals.params[13].rgb, globals.params[14].rgb, bands);
  let sourceStraight = source.rgb / max(source.a, 0.00001);
  let color = mix(sourceStraight, pigment * relief, bands * 0.92);
  return vec4f(mix(sourceStraight, color, amount) * source.a, source.a);
}`;

export const SOURCE_REACTION_DIFFUSION_EFFECT: EffectDefinition = {
  id: "an-native-owned-av-source-reaction-diffusion",
  name: "Source Reaction Diffusion",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    feed: {
      type: "float",
      label: "Feed",
      default: 0.041,
      min: 0.005,
      max: 0.12,
      step: 0.001,
    },
    kill: {
      type: "float",
      label: "Kill",
      default: 0.061,
      min: 0.02,
      max: 0.095,
      step: 0.001,
    },
    diffusionU: {
      type: "float",
      label: "Diffusion U",
      default: 1,
      min: 0.1,
      max: 1.2,
      step: 0.01,
    },
    diffusionV: {
      type: "float",
      label: "Diffusion V",
      default: 0.5,
      min: 0.05,
      max: 1,
      step: 0.01,
    },
    rate: {
      type: "float",
      label: "Reaction rate",
      default: 0.85,
      min: 0.1,
      max: 1,
      step: 0.01,
    },
    sourceInfluence: {
      type: "float",
      label: "Source influence",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    sourceThreshold: {
      type: "float",
      label: "Source threshold",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    seedDensity: {
      type: "float",
      label: "Seed density",
      default: 0.065,
      min: 0.005,
      max: 0.25,
      step: 0.001,
    },
    brushRadius: {
      type: "float",
      label: "Brush radius",
      default: 65,
      min: 10,
      max: 220,
      step: 1,
      unit: "px",
    },
    brushStrength: {
      type: "float",
      label: "Brush strength",
      default: 0.55,
      min: 0,
      max: 1,
      step: 0.01,
    },
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: false },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.85,
      min: 0,
      max: 1,
      step: 0.01,
    },
    lowColor: {
      type: "color",
      label: "Low color",
      default: { space: "srgb", components: [0.1, 0.28, 0.38], alpha: 1 },
    },
    highColor: {
      type: "color",
      label: "High color",
      default: { space: "srgb", components: [0.88, 0.72, 0.38], alpha: 1 },
    },
    relief: {
      type: "float",
      label: "Relief",
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.01,
    },
    patternSeed: {
      type: "int",
      label: "Pattern seed",
      default: 23,
      min: 0,
      max: 100000,
      step: 1,
    },
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
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
    {
      name: "field",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      size: "fixed",
      width: 256,
      height: 256,
      persistent: true,
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: {
    abi: "stateful-resource-v1",
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 8, maxStepIndex: 36000 },
    stateResources: ["field"],
    sourceHistory: "sequential-captures",
    resetProperties: ["patternSeed", "seedDensity"],
  },
  passes: [
    {
      id: "advance-field",
      kind: "compute",
      wgsl: reactionStepWgsl,
      reads: ["source"],
      previousFrameReads: ["field"],
      output: "field",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "paint-reaction",
      kind: "render",
      wgsl: reactionPaintWgsl,
      reads: ["source", "field"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded source-guided two-reagent reaction field with independent feed, kill, diffusion, pointer injection, and premultiplied source composite.",
  },
};

const base = {
  diffusionU: 1,
  diffusionV: 0.5,
  rate: 1,
  sourceInfluence: 0.5,
  sourceThreshold: 0.5,
  seedDensity: 0.065,
  brushRadius: 65,
  brushStrength: 0.55,
  pointerPosition: [0.5, 0.5] as [number, number],
  pointerActive: false,
  amount: 0.85,
  lowColor: {
    space: "srgb" as const,
    components: [0.1, 0.28, 0.38] as [number, number, number],
    alpha: 1,
  },
  highColor: {
    space: "srgb" as const,
    components: [0.88, 0.72, 0.38] as [number, number, number],
    alpha: 1,
  },
  relief: 0.7,
  patternSeed: 23,
};

export const SOURCE_REACTION_DIFFUSION_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-av-source-reaction-ribbon-garden",
    name: "Ribbon Garden",
    definitionId: SOURCE_REACTION_DIFFUSION_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { ...base, feed: 0.041, kill: 0.061 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-av-source-reaction-stone-bloom",
    name: "Stone Bloom",
    definitionId: SOURCE_REACTION_DIFFUSION_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      ...base,
      feed: 0.029,
      kill: 0.057,
      sourceInfluence: 0.8,
      seedDensity: 0.09,
      highColor: { space: "srgb", components: [0.82, 0.45, 0.53], alpha: 1 },
      patternSeed: 71,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
