import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const advanceWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var<storage, read> previousPoints: array<vec4f>;
@group(0) @binding(3) var<storage, read> previousCursor: array<vec4f>;
@group(0) @binding(18) var<storage, read_write> nextPoints: array<vec4f>;
@compute @workgroup_size(64, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x != 0u) { return; }
  let position = clamp(globals.params[7].xy, vec2f(0.0), vec2f(1.0));
  let engaged = globals.params[8].x > 0.5;
  let cursor = previousCursor[0];
  let initialized = cursor.w > 0.5;
  let dt = max(globals.clock.w, 0.0);
  let sizeCss = globals.viewport.xy / max(globals.clock.z, 0.01);
  let traveled = length((position - cursor.xy) * sizeCss);
  let spacing = max(globals.params[1].x, 1.0);
  let insert = engaged && (!initialized || cursor.z < 0.5 || traveled >= spacing);
  let speed = traveled / max(dt, 0.0001);
  let width = max(0.2, sqrt(clamp(speed / 650.0, 0.0, 1.0)));
  let lifespan = max(globals.params[2].x, 0.05);
  for (var i = 0u; i < 64u; i += 1u) {
    var point = vec4f(0.0, 0.0, -1.0, -1.0);
    if (initialized) {
      let priorIndex = select(i, i - 1u, insert && i > 0u);
      if (!insert || i > 0u) { point = previousPoints[priorIndex]; }
      if (point.z >= 0.0) {
        point.z += dt / lifespan;
        if (point.z >= 1.0) { point.z = -1.0; }
      }
    }
    if (insert && i == 0u) {
      let linked = initialized && cursor.z > 0.5 && previousPoints[0].z >= 0.0;
      point = vec4f(position, 0.0, select(-width, width, linked));
    } else if (engaged && initialized && !insert && i == 0u && point.z >= 0.0) {
      point = vec4f(position, 0.0, select(-width, width, point.w > 0.0));
    }
    nextPoints[i] = point;
  }
}`;

const cursorWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(3) var<storage, read> previousCursor: array<vec4f>;
@group(0) @binding(18) var<storage, read_write> nextCursor: array<vec4f>;
@compute @workgroup_size(1, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x == 0u) {
    nextCursor[0] = vec4f(clamp(globals.params[7].xy, vec2f(0.0), vec2f(1.0)), select(0.0, 1.0, globals.params[8].x > 0.5), 1.0);
  }
}`;

const resolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> points: array<vec4f>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[index], 0.0, 1.0);
  output.uv = triangle[index] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[6].x;
  if (amount <= 0.0) { return source; }
  let sizeCss = globals.viewport.xy / max(globals.clock.z, 0.01);
  let here = input.uv * sizeCss;
  var coverage = 0.0;
  var nearestUv = input.uv;
  for (var i = 0u; i < 64u; i += 1u) {
    let head = points[i];
    if (head.z < 0.0 || head.z >= 1.0) { continue; }
    var nearest = head.xy * sizeCss;
    var width = abs(head.w);
    if (head.w > 0.0 && i < 63u) {
      let tail = points[i + 1u];
      if (tail.z >= 0.0 && tail.z < 1.0) {
        let edge = (tail.xy - head.xy) * sizeCss;
        let fraction = clamp(dot(here - nearest, edge) / max(dot(edge, edge), 0.0001), 0.0, 1.0);
        nearest += fraction * edge;
        width = mix(abs(head.w), abs(tail.w), fraction);
      }
    }
    let radius = max(0.5, globals.params[0].x * width * 0.5);
    let distance = length(here - nearest);
    let edgeCoverage = 1.0 - smoothstep(radius - 1.0, radius + 1.0, distance);
    let ageCoverage = pow(1.0 - head.z, max(globals.params[3].x, 0.1));
    let candidate = edgeCoverage * ageCoverage;
    if (candidate > coverage) {
      coverage = candidate;
      nearestUv = nearest / sizeCss;
    }
  }
  if (coverage <= 0.0) { return source; }
  let sampled = textureSampleLevel(sourceTexture, effectSampler, clamp(nearestUv, vec2f(0.0), vec2f(1.0)), 0.0);
  if (sampled.a <= 0.00001) { return source; }
  let ink = globals.params[4];
  let straight = sampled.rgb / sampled.a;
  let strokeRgb = mix(straight, ink.rgb, globals.params[5].x);
  let strokeAlpha = clamp(coverage * amount * ink.a * sampled.a, 0.0, 1.0);
  return vec4f(strokeRgb * strokeAlpha + source.rgb * (1.0 - strokeAlpha), strokeAlpha + source.a * (1.0 - strokeAlpha));
}`;

const scalar = (
  label: string,
  value: number,
  min: number,
  max: number,
  unit?: "px",
) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
  ...(unit ? { unit } : {}),
});

export const RETAINED_POINTER_STROKE_EFFECT: EffectDefinition = {
  id: "an-native-owned-bw-retained-pointer-stroke",
  name: "Retained Pointer Stroke",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    strokeWidth: scalar("Stroke width", 18, 1, 90, "px"),
    anchorSpacing: scalar("Anchor spacing", 8, 1, 28, "px"),
    trailLifetime: scalar("Trail lifetime", 1.1, 0.1, 4),
    ageFalloff: scalar("Age falloff", 1.4, 0.2, 4),
    strokeColor: {
      type: "color",
      label: "Stroke color",
      default: { space: "srgb", components: [0.96, 0.65, 0.28], alpha: 0.85 },
    },
    colorMix: scalar("Stroke color mix", 0.4, 0, 1),
    amount: scalar("Amount", 0.85, 0, 1),
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    pointerActive: { type: "bool", label: "Pointer active", default: true },
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
      name: "points",
      kind: "buffer",
      usage: ["storage"],
      persistent: true,
      size: "fixed",
      byteLength: 1024,
    },
    {
      name: "cursor",
      kind: "buffer",
      usage: ["storage"],
      persistent: true,
      size: "fixed",
      byteLength: 16,
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
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 16, maxStepIndex: 36_000 },
    stateResources: ["points", "cursor"],
    sourceHistory: "sequential-captures",
  },
  passes: [
    {
      id: "advance-stroke",
      kind: "compute",
      reads: [],
      previousFrameReads: ["points", "cursor"],
      output: "points",
      dispatch: { elements: "output-buffer", workgroupSize: [64, 1, 1] },
      wgsl: advanceWgsl,
    },
    {
      id: "capture-cursor",
      kind: "compute",
      reads: [],
      previousFrameReads: ["cursor"],
      output: "cursor",
      dispatch: { elements: "output-buffer", workgroupSize: [1, 1, 1] },
      wgsl: cursorWgsl,
    },
    {
      id: "resolve-stroke",
      kind: "render",
      reads: ["source", "points"],
      output: "color",
      wgsl: resolveWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "A bounded retained pointer polyline is rasterized as aged capsules, with each stroke segment sampling the actual selected source and preserving premultiplied alpha.",
  },
};

export const RETAINED_POINTER_STROKE_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bw-retained-pointer-amber-ink",
    name: "Amber Ink",
    definitionId: RETAINED_POINTER_STROKE_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      strokeWidth: 16,
      anchorSpacing: 7,
      trailLifetime: 1.35,
      ageFalloff: 1.2,
      colorMix: 0.58,
      amount: 0.9,
      pointerActive: true,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bw-retained-pointer-source-thread",
    name: "Source Thread",
    definitionId: RETAINED_POINTER_STROKE_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      strokeWidth: 8,
      anchorSpacing: 4,
      trailLifetime: 2.2,
      ageFalloff: 2.3,
      colorMix: 0.08,
      amount: 1,
      pointerActive: true,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
