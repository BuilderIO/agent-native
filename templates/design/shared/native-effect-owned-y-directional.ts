import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const tensorWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var tensorOutput: texture_storage_2d<rgba16float, write>;

fn sourceAt(point: vec2i, dimensions: vec2i) -> vec4f {
  let bounded = clamp(point, vec2i(0), dimensions - vec2i(1));
  let uv = (vec2f(bounded) + vec2f(0.5)) / vec2f(dimensions);
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}

fn lumaAt(point: vec2i, dimensions: vec2i) -> f32 {
  let pixel = sourceAt(point, dimensions);
  return dot(pixel.rgb, vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8, 1) fn cs(@builtin(global_invocation_id) globalId: vec3u) {
  let dimensions = vec2i(textureDimensions(tensorOutput));
  if (globalId.x >= u32(dimensions.x) || globalId.y >= u32(dimensions.y)) { return; }
  let point = vec2i(globalId.xy);
  var xx = 0.0;
  var xy = 0.0;
  var yy = 0.0;
  var weightSum = 0.0;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let samplePoint = clamp(point + vec2i(x, y), vec2i(0), dimensions - vec2i(1));
      let alpha = max(sourceAt(samplePoint, dimensions).a, 0.0);
      let gx = 0.5 * (lumaAt(samplePoint + vec2i(1, 0), dimensions) -
        lumaAt(samplePoint - vec2i(1, 0), dimensions));
      let gy = 0.5 * (lumaAt(samplePoint + vec2i(0, 1), dimensions) -
        lumaAt(samplePoint - vec2i(0, 1), dimensions));
      let weight = alpha * select(1.0, 2.0, x == 0 && y == 0);
      xx += weight * gx * gx;
      xy += weight * gx * gy;
      yy += weight * gy * gy;
      weightSum += weight;
    }
  }
  if (weightSum <= 0.00001) {
    textureStore(tensorOutput, point, vec4f(1.0, 0.0, 0.0, 1.0));
    return;
  }
  xx /= weightSum;
  xy /= weightSum;
  yy /= weightSum;
  let delta = sqrt(max((xx - yy) * (xx - yy) + 4.0 * xy * xy, 0.0));
  let coherence = clamp(delta / max(xx + yy, 0.00001), 0.0, 1.0);
  let direction = select(vec2f(1.0, 0.0),
    vec2f((xx - yy) / max(delta, 0.00001), 2.0 * xy / max(delta, 0.00001)),
    delta > 0.00001);
  textureStore(tensorOutput, point, vec4f(direction, coherence, 1.0));
}`;

const resolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var tensorTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);
  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = clamp(globals.params[2].x, 0.0, 1.0);
  if (amount <= 0.0 || original.a <= 0.00001) { return original; }

  let tensor = textureSampleLevel(tensorTexture, effectSampler, input.uv, 0.0);
  let angle = 0.5 * atan2(tensor.y, tensor.x);
  var tangent = vec2f(-sin(angle), cos(angle));
  if (tangent.x < 0.0) { tangent = -tangent; }
  let steer = clamp(globals.params[1].x, 0.0, 1.0) * clamp(tensor.z, 0.0, 1.0);
  let axis = normalize(mix(vec2f(1.0, 0.0), tangent, steer));
  let normal = vec2f(-axis.y, axis.x);
  let radius = clamp(globals.params[0].x, 1.0, 8.0) * max(globals.clock.z, 1.0);
  let along = 1.0 + 0.8 * steer;
  let across = 1.0 - 0.45 * steer;
  var bestVariance = 1e20;
  var bestColor = original.rgb / max(original.a, 0.00001);

  for (var sector = 0; sector < 4; sector += 1) {
    var signX = -1.0;
    var signY = -1.0;
    if (sector == 1 || sector == 3) { signX = 1.0; }
    if (sector >= 2) { signY = 1.0; }
    var sumColor = vec3f(0.0);
    var sumSquare = vec3f(0.0);
    var weightSum = 0.0;
    for (var y = 0; y <= 2; y += 1) {
      for (var x = 0; x <= 2; x += 1) {
        let local = vec2f(signX * f32(x), signY * f32(y));
        let offset = (axis * local.x * along + normal * local.y * across) * (radius * 0.5);
        let uv = clamp(input.uv + offset * globals.viewport.zw, vec2f(0.0), vec2f(1.0));
        let sample = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
        let alpha = max(sample.a, 0.0);
        if (alpha <= 0.00001) { continue; }
        let color = sample.rgb / alpha;
        let weight = alpha / (1.0 + 0.2 * dot(local, local));
        sumColor += color * weight;
        sumSquare += color * color * weight;
        weightSum += weight;
      }
    }
    if (weightSum <= 0.00001) { continue; }
    let mean = sumColor / weightSum;
    let variance = max(sumSquare / weightSum - mean * mean, vec3f(0.0));
    let score = dot(variance, vec3f(0.3333333));
    if (score < bestVariance) {
      bestVariance = score;
      bestColor = mean;
    }
  }
  return vec4f(mix(original.rgb, bestColor * original.a, amount), original.a);
}`;

export const STEERED_KUWAHARA_EFFECT: EffectDefinition = {
  id: "an-native-owned-y-steered-kuwahara",
  name: "Steered Kuwahara",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    radius: {
      type: "float",
      label: "Radius",
      default: 3,
      min: 1,
      max: 8,
      step: 0.1,
      unit: "px",
    },
    directionality: {
      type: "float",
      label: "Directionality",
      default: 0.7,
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
    {
      name: "tensor",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "storage"],
      size: "viewport",
    },
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
      id: "structure-tensor",
      kind: "compute",
      reads: ["source"],
      output: "tensor",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
      wgsl: tensorWgsl,
    },
    {
      id: "steered-sector-resolve",
      kind: "render",
      reads: ["source", "tensor"],
      output: "color",
      wgsl: resolveWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded structure-tensor and four-sector variance smoothing. The resolve preserves premultiplied alpha and returns exact source when Amount is zero.",
  },
};

export const STEERED_KUWAHARA_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-y-steered-kuwahara-soft-brushwork",
    name: "Soft brushwork",
    definitionId: STEERED_KUWAHARA_EFFECT.id,
    definitionVersion: STEERED_KUWAHARA_EFFECT.version,
    placement: "layer",
    params: { radius: 2.5, directionality: 0.4, amount: 0.65 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-y-steered-kuwahara-flowing-strokes",
    name: "Flowing strokes",
    definitionId: STEERED_KUWAHARA_EFFECT.id,
    definitionVersion: STEERED_KUWAHARA_EFFECT.version,
    placement: "layer",
    params: { radius: 6, directionality: 0.95, amount: 0.92 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
