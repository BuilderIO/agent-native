import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const trailAdvanceWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var priorTrail: texture_2d<f32>;
@group(0) @binding(4) var priorSource: texture_2d<f32>;
@group(0) @binding(18) var nextTrail: texture_storage_2d<rgba16float, write>;

fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn historyAt(uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(priorTrail, effectSampler, uv, 0.0);
}
fn tentAt(uv: vec2f, texel: vec2f) -> vec4f {
  let axial = historyAt(uv + vec2f(texel.x, 0.0))
    + historyAt(uv - vec2f(texel.x, 0.0))
    + historyAt(uv + vec2f(0.0, texel.y))
    + historyAt(uv - vec2f(0.0, texel.y));
  let diagonal = historyAt(uv + texel) + historyAt(uv - texel)
    + historyAt(uv + vec2f(texel.x, -texel.y))
    + historyAt(uv + vec2f(-texel.x, texel.y));
  return (historyAt(uv) * 4.0 + axial * 2.0 + diagonal) * (1.0 / 16.0);
}

@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = textureDimensions(nextTrail);
  if (any(invocation.xy >= dimensions)) { return; }
  let uv = (vec2f(invocation.xy) + vec2f(0.5)) / vec2f(dimensions);
  let dt = globals.clock.w;
  if (dt <= 0.0) {
    textureStore(nextTrail, vec2i(invocation.xy), vec4f(0.0));
    return;
  }

  let drift = vec2f(globals.params[5].x, globals.params[6].x);
  let driftUv = drift * globals.clock.z * dt / globals.viewport.xy;
  let zoom = exp(globals.params[7].x * dt);
  let previousUv = (uv - vec2f(0.5)) * zoom + vec2f(0.5) - driftUv;
  let old = historyAt(previousUv);
  let spread = tentAt(previousUv, vec2f(1.0) / vec2f(dimensions));
  let diffusion = 1.0 - exp(-globals.params[4].x * dt);
  let retained = mix(old, spread, diffusion) * exp(-dt / globals.params[0].x);

  let current = sourceAt(uv);
  let previous = textureSampleLevel(priorSource, effectSampler, uv, 0.0);
  let change = dot(abs(current.rgb - previous.rgb), vec3f(0.2126, 0.7152, 0.0722))
    + abs(current.a - previous.a) * 0.5;
  let motion = smoothstep(globals.params[3].x, globals.params[3].x + 0.08, change);
  let mask = select(current.a, current.a * motion, globals.params[2].x > 0.5);
  let stamp = (1.0 - exp(-globals.params[1].x * dt)) * mask;
  let fresh = current * (stamp / max(current.a, 0.00001));
  let combined = fresh + retained * (1.0 - stamp);
  textureStore(nextTrail, vec2i(invocation.xy), vec4f(combined.rgb, clamp(combined.a, 0.0, 1.0)));
}`;

const sourceCaptureWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var nextSource: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let dimensions = textureDimensions(nextSource);
  if (any(invocation.xy >= dimensions)) { return; }
  let uv = (vec2f(invocation.xy) + vec2f(0.5)) / vec2f(dimensions);
  textureStore(nextSource, vec2i(invocation.xy), textureSampleLevel(sourceTexture, effectSampler, uv, 0.0));
}`;

const compositeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var trailTexture: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[10].x;
  if (amount <= 0.0) { return source; }
  let history = textureSampleLevel(trailTexture, effectSampler, input.uv, 0.0);
  let tint = mix(vec3f(1.0), globals.params[8].rgb, globals.params[9].x);
  let ghost = vec4f(history.rgb * tint, history.a) * amount;
  return ghost + source * (1.0 - ghost.a);
}`;

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

const fixedState = (name: string) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  persistent: true,
  size: "fixed" as const,
  width: 512,
  height: 512,
});

export const TEMPORAL_FLOW_TRAIL_EFFECT: EffectDefinition = {
  id: "an-native-owned-exposure-trail",
  name: "Exposure Trail",
  version: 2,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    trailSeconds: {
      type: "float",
      label: "Trail time",
      default: 1.2,
      min: 0.1,
      max: 12,
      step: 0.1,
      unit: "s",
    },
    stampRate: {
      type: "float",
      label: "Stamp rate",
      default: 8,
      min: 0.1,
      max: 30,
      step: 0.1,
    },
    stampMode: {
      type: "enum",
      label: "Stamp mode",
      default: "alpha",
      options: ["alpha", "motion"],
    },
    motionSensitivity: {
      type: "float",
      label: "Motion sensitivity",
      default: 0.12,
      min: 0,
      max: 0.8,
      step: 0.01,
    },
    diffusion: {
      type: "float",
      label: "Diffusion",
      default: 2,
      min: 0,
      max: 20,
      step: 0.1,
    },
    driftX: {
      type: "float",
      label: "Horizontal drift",
      default: 0,
      min: -120,
      max: 120,
      step: 1,
      unit: "px",
    },
    driftY: {
      type: "float",
      label: "Vertical drift",
      default: -12,
      min: -120,
      max: 120,
      step: 1,
      unit: "px",
    },
    zoomRate: {
      type: "float",
      label: "Zoom drift",
      default: 0,
      min: -0.5,
      max: 0.5,
      step: 0.01,
    },
    trailColor: {
      type: "color",
      label: "Trail color",
      default: color([0.55, 0.78, 1]),
    },
    colorMix: {
      type: "float",
      label: "Color mix",
      default: 0.4,
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
    fixedState("trail"),
    fixedState("priorSource"),
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
    stateResources: ["trail", "priorSource"],
    sourceHistory: "sequential-captures",
  },
  passes: [
    {
      id: "advance-trail",
      kind: "compute",
      reads: ["source"],
      previousFrameReads: ["trail", "priorSource"],
      output: "trail",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: trailAdvanceWgsl,
    },
    {
      id: "capture-source",
      kind: "compute",
      reads: ["source"],
      output: "priorSource",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: sourceCaptureWgsl,
    },
    {
      id: "composite",
      kind: "render",
      reads: ["source", "trail"],
      output: "color",
      wgsl: compositeWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original time-scaled source-frame accumulation with advection, diffusion, and motion stamping.",
  },
};

export const TEMPORAL_FLOW_TRAIL_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-aw-soft-exposure",
    name: "Soft Exposure",
    definitionId: TEMPORAL_FLOW_TRAIL_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      trailSeconds: 2.4,
      stampRate: 5.5,
      stampMode: "alpha",
      motionSensitivity: 0.12,
      diffusion: 7,
      driftX: 0,
      driftY: -9,
      zoomRate: 0.025,
      trailColor: color([0.66, 0.83, 1]),
      colorMix: 0.35,
      amount: 0.74,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-aw-motion-echo",
    name: "Motion Echo",
    definitionId: TEMPORAL_FLOW_TRAIL_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    params: {
      trailSeconds: 0.9,
      stampRate: 22,
      stampMode: "motion",
      motionSensitivity: 0.075,
      diffusion: 0.8,
      driftX: 16,
      driftY: 0,
      zoomRate: -0.015,
      trailColor: color([1, 0.49, 0.27]),
      colorMix: 0.6,
      amount: 0.96,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const TEMPORAL_FLOW_TRAIL_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  TEMPORAL_FLOW_TRAIL_PRESETS.map((preset) => [preset.id, preset.id]),
);
