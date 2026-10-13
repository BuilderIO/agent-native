import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const bendWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
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
fn surfaceDepth(across: f32, reach: f32) -> f32 {
  let normalized = clamp(abs(across) / max(reach, 0.0001), 0.0, 1.0);
  let broad = normalized * normalized;
  let endCurl = broad * broad * normalized;
  return globals.params[0].x * 0.4 * mix(broad, endCurl, globals.params[1].x);
}
fn projectedAcross(across: f32, reach: f32) -> f32 {
  let distance = globals.params[3].x;
  return across * distance / (distance - surfaceDepth(across, reach));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv);
  let amount = globals.params[5].x;
  if (amount <= 0.0) { return original; }
  let aspect = globals.viewport.x / globals.viewport.y;
  let center = globals.params[4].xy;
  let screen = (input.uv - center) * vec2f(aspect, -1.0);
  let angle = globals.params[2].x;
  let normal = vec2f(cos(angle), sin(angle));
  let axis = vec2f(-sin(angle), cos(angle));
  let screenAcross = dot(screen, normal);
  let screenAlong = dot(screen, axis);
  let horizontalReach = max(center.x, 1.0 - center.x) * aspect;
  let verticalReach = max(center.y, 1.0 - center.y);
  let reach = abs(normal.x) * horizontalReach + abs(normal.y) * verticalReach;
  let projectedReach = projectedAcross(reach, reach);
  if (abs(screenAcross) > projectedReach) { return original * (1.0 - amount); }
  var lower = -reach;
  var upper = reach;
  for (var iteration = 0u; iteration < 18u; iteration += 1u) {
    let midpoint = (lower + upper) * 0.5;
    if (projectedAcross(midpoint, reach) < screenAcross) { lower = midpoint; }
    else { upper = midpoint; }
  }
  let across = (lower + upper) * 0.5;
  let scale = (globals.params[3].x - surfaceDepth(across, reach)) / globals.params[3].x;
  let plane = normal * across + axis * (screenAlong * scale);
  let uv = plane / vec2f(aspect, -1.0) + center;
  return mix(original, sourceAt(uv), amount);
}`;

export const PERSPECTIVE_BEND_EFFECT: EffectDefinition = {
  id: "an-native-owned-s-parabolic-bend",
  name: "Perspective Bend",
  version: 3,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    strength: {
      type: "float",
      label: "Bend strength",
      default: 0.75,
      min: -1,
      max: 1,
      step: 0.01,
    },
    endFalloff: {
      type: "float",
      label: "End falloff",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
    },
    axisAngle: {
      type: "float",
      label: "Bend axis",
      default: 0,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    cameraDistance: {
      type: "float",
      label: "Camera distance",
      default: 2.4,
      min: 1.8,
      max: 5,
      step: 0.01,
    },
    center: {
      type: "vec2",
      label: "Bend center",
      default: [0.5, 0.5],
      min: 0,
      max: 1,
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 1,
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
      id: "inverse-perspective-bend",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl: bendWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded inverse camera projection of a curved source plane; bend depth affects both image axes and transparent bounds.",
  },
};

export const PERSPECTIVE_BEND_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bu-convex-display",
    name: "Convex Display",
    definitionId: PERSPECTIVE_BEND_EFFECT.id,
    definitionVersion: 3,
    placement: "layer",
    params: {
      strength: 0.75,
      endFalloff: 0.4,
      axisAngle: 0,
      cameraDistance: 2.4,
      center: [0.5, 0.5],
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bu-receding-curl",
    name: "Receding Curl",
    definitionId: PERSPECTIVE_BEND_EFFECT.id,
    definitionVersion: 3,
    placement: "layer",
    params: {
      strength: -0.84,
      endFalloff: 0.88,
      axisAngle: 0.72,
      cameraDistance: 2.05,
      center: [0.45, 0.55],
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const PERSPECTIVE_BEND_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  PERSPECTIVE_BEND_PRESETS.map((preset) => [preset.id, preset.id]),
);
