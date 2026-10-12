import {
  NATIVE_GRAPH_GLOBALS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const filmWgsl = `${NATIVE_RENDER_GLOBALS}
fn grainHash(pixel: vec2u, frame: u32, seed: u32) -> f32 {
  var value = pixel.x * 1664525u + pixel.y * 1013904223u + frame * 747796405u + seed * 2246822519u;
  value = ((value >> 16u) ^ value) * 3266489917u;
  return f32((value >> 8u) & 16777215u) / 16777216.0;
}
fn channelCurve(signal: f32, toe: f32, shoulder: f32) -> f32 {
  let positive = max(signal, 0.0);
  let toeShape = pow(positive, 1.0 + toe * 0.72);
  return toeShape * (1.0 + shoulder) / (1.0 + shoulder * toeShape);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = clamp(globals.params[7].x, 0.0, 1.0);
  if (amount <= 0.0) { return original; }
  let pixel = max(globals.clock.z, 1.0) * globals.viewport.zw;
  let frame = floor(globals.clock.x * 24.0);
  let seed = globals.params[8].x;
  let weave = globals.params[5].x * pixel * vec2f(
    sin(frame * 0.71 + seed * 0.29),
    sin(frame * 0.37 + seed * 0.53)
  );
  let source = textureSampleLevel(sourceTexture, effectSampler,
    clamp(input.uv + weave, vec2f(0.0), vec2f(1.0)), 0.0);
  if (source.a <= 0.00001) { return mix(original, source, amount); }
  let profile = clamp(globals.params[4].x, 0.0, 1.0);
  let exposure = exp2(globals.params[0].x);
  let straight = max(source.rgb / source.a, vec3f(0.0)) * exposure;
  let crosstalk = globals.params[3].x;
  let coupled = mix(straight, vec3f(
    straight.r * 0.92 + straight.g * 0.08,
    straight.g * 0.94 + straight.b * 0.06,
    straight.b * 0.91 + straight.r * 0.09
  ), crosstalk);
  let bias = mix(vec3f(1.06, 1.0, 0.94), vec3f(0.94, 1.0, 1.08), profile);
  let curve = vec3f(
    channelCurve(coupled.r * bias.r, globals.params[1].x * (0.9 + profile * 0.2), globals.params[2].x),
    channelCurve(coupled.g * bias.g, globals.params[1].x, globals.params[2].x * 0.93),
    channelCurve(coupled.b * bias.b, globals.params[1].x * (1.1 - profile * 0.2), globals.params[2].x * 1.08)
  );
  let frameIndex = u32(max(frame, 0.0));
  let noise = grainHash(vec2u(input.uv * globals.viewport.xy), frameIndex, u32(seed)) - 0.5;
  let grainEnvelope = sqrt(max(dot(curve, vec3f(0.2126, 0.7152, 0.0722)), 0.0)) *
    (1.0 - smoothstep(0.75, 1.5, dot(curve, vec3f(0.2126, 0.7152, 0.0722))));
  let textured = max(curve + vec3f(noise * globals.params[6].x * grainEnvelope * 0.12), vec3f(0.0));
  return mix(original, vec4f(textured * source.a, source.a), amount);
}`;

const codecComputeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var encodedTexture: texture_storage_2d<rgba16float, write>;
var<workgroup> tileY: array<f32, 64>;
var<workgroup> tileCb: array<f32, 64>;
var<workgroup> tileCr: array<f32, 64>;
var<workgroup> tileAlpha: array<f32, 64>;
var<workgroup> rowFrequency: array<f32, 64>;
var<workgroup> coefficients: array<f32, 64>;
var<workgroup> inverseColumn: array<f32, 64>;

fn basis(frequency: u32, position: u32) -> f32 {
  let scale = select(0.5, 0.3535533905932738, frequency == 0u);
  return scale * cos((2.0 * f32(position) + 1.0) * f32(frequency) * 0.19634954084936207);
}
fn sourceAt(pixel: vec2u, extent: vec2u) -> vec4f {
  let uv = (vec2f(pixel) + vec2f(0.5)) / vec2f(extent);
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn chromaCell(cell: vec2u) -> vec2f {
  let origin = clamp(cell, vec2u(0), vec2u(3)) * 2u;
  var sum = vec2f(0.0);
  var coverage = 0.0;
  for (var y = 0u; y < 2u; y += 1u) {
    for (var x = 0u; x < 2u; x += 1u) {
      let index = (origin.y + y) * 8u + origin.x + x;
      let weight = tileAlpha[index];
      sum += vec2f(tileCb[index], tileCr[index]) * weight;
      coverage += weight;
    }
  }
  return sum / max(coverage, 0.00001);
}

@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) lane: vec3u) {
  let extent = textureDimensions(encodedTexture);
  let origin = group.xy * 8u;
  let pixel = origin + lane.xy;
  let inside = all(pixel < extent);
  let complete = all(origin + vec2u(8) <= extent);
  if (!complete || globals.params[4].x <= 0.0) {
    if (inside) { textureStore(encodedTexture, vec2i(pixel), sourceAt(pixel, extent)); }
    return;
  }
  let index = lane.y * 8u + lane.x;
  let source = sourceAt(pixel, extent);
  let straight = select(vec3f(0.0), source.rgb / max(source.a, 0.00001), source.a > 0.00001);
  let y = dot(straight, vec3f(0.299, 0.587, 0.114));
  tileY[index] = y;
  tileCb[index] = (straight.b - y) * 0.564;
  tileCr[index] = (straight.r - y) * 0.713;
  tileAlpha[index] = source.a;
  workgroupBarrier();

  var rowCoefficient = 0.0;
  for (var sampleX = 0u; sampleX < 8u; sampleX += 1u) {
    rowCoefficient += tileY[lane.y * 8u + sampleX] * basis(lane.x, sampleX);
  }
  rowFrequency[index] = rowCoefficient;
  workgroupBarrier();
  var coefficient = 0.0;
  for (var sampleY = 0u; sampleY < 8u; sampleY += 1u) {
    coefficient += rowFrequency[sampleY * 8u + lane.x] * basis(lane.y, sampleY);
  }
  let frequency = f32(lane.x + lane.y) / 14.0;
  let quantStep = max(globals.params[0].x * (1.0 + globals.params[1].x * frequency), 0.000001);
  coefficients[index] = floor(coefficient / quantStep + 0.5) * quantStep;
  workgroupBarrier();

  var columnValue = 0.0;
  for (var ky = 0u; ky < 8u; ky += 1u) {
    columnValue += coefficients[ky * 8u + lane.x] * basis(ky, lane.y);
  }
  inverseColumn[index] = columnValue;
  workgroupBarrier();
  var rebuiltY = 0.0;
  for (var kx = 0u; kx < 8u; kx += 1u) {
    rebuiltY += inverseColumn[lane.y * 8u + kx] * basis(kx, lane.x);
  }
  let chromaLoss = globals.params[2].x;
  let cell = lane.xy / 2u;
  let nearest = chromaCell(cell);
  let neighborX = chromaCell(vec2u(vec2i(select(max(i32(cell.x) - 1, 0), min(i32(cell.x) + 1, 3), lane.x % 2u == 1u), i32(cell.y))));
  let neighborY = chromaCell(vec2u(vec2i(i32(cell.x), select(max(i32(cell.y) - 1, 0), min(i32(cell.y) + 1, 3), lane.y % 2u == 1u))));
  let subsampled = mix(nearest, (nearest * 2.0 + neighborX + neighborY) * 0.25, globals.params[3].x);
  var chroma = mix(vec2f(tileCb[index], tileCr[index]), subsampled, chromaLoss);
  let chromaStep = max(globals.params[0].x * (0.5 + chromaLoss * 2.0), 0.000001);
  chroma = floor(chroma / chromaStep + vec2f(0.5)) * chromaStep;
  let rebuilt = max(vec3f(
    rebuiltY + 1.402 * chroma.y,
    rebuiltY - 0.344136 * chroma.x - 0.714136 * chroma.y,
    rebuiltY + 1.772 * chroma.x
  ), vec3f(0.0));
  textureStore(encodedTexture, vec2i(pixel), vec4f(rebuilt * source.a, source.a));
}`;

const codecResolveWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var encodedTexture: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(coordinates[index], 0.0, 1.0);
  output.uv = coordinates[index] * vec2f(0.5, -0.5) + vec2f(0.5);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = clamp(globals.params[4].x, 0.0, 1.0);
  if (amount <= 0.0) { return original; }
  let encoded = textureSampleLevel(encodedTexture, effectSampler, input.uv, 0.0);
  return vec4f(mix(original.rgb, encoded.rgb, amount), original.a);
}`;

export const FILM_CODEC_DEFINITIONS: readonly EffectDefinition[] = [
  {
    id: "an-native-owned-al-film-response",
    name: "Original Film Response",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      exposure: {
        type: "float",
        label: "Exposure",
        default: 0,
        min: -2,
        max: 2,
        step: 0.01,
      },
      toe: {
        type: "float",
        label: "Toe",
        default: 0.38,
        min: 0,
        max: 1,
        step: 0.01,
      },
      shoulder: {
        type: "float",
        label: "Shoulder",
        default: 0.46,
        min: 0,
        max: 1,
        step: 0.01,
      },
      channelCoupling: {
        type: "float",
        label: "Channel coupling",
        default: 0.36,
        min: 0,
        max: 1,
        step: 0.01,
      },
      profile: {
        type: "float",
        label: "Color response",
        default: 0.3,
        min: 0,
        max: 1,
        step: 0.01,
      },
      gateWeave: {
        type: "float",
        label: "Gate weave",
        default: 0.65,
        min: 0,
        max: 3,
        step: 0.01,
        unit: "px",
      },
      grain: {
        type: "float",
        label: "Temporal grain",
        default: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      },
      amount: {
        type: "float",
        label: "Amount",
        default: 0.85,
        min: 0,
        max: 1,
        step: 0.01,
      },
      patternSeed: {
        type: "float",
        label: "Pattern seed",
        default: 24,
        min: 0,
        max: 100,
        step: 1,
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
    passes: [
      {
        id: "film-response",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: filmWgsl,
      },
    ],
    output: "color",
    provenance: {
      origin: "design-original",
      note: "Original per-channel toe/shoulder response, cross-channel coupling, source gate weave, and time-varying grain. Profiles are authored looks, not measured film stocks.",
    },
  },
  {
    id: "an-native-owned-al-color-codec",
    name: "Color Codec",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      quantization: {
        type: "float",
        label: "Coefficient step",
        default: 0.075,
        min: 0,
        max: 0.3,
        step: 0.005,
      },
      frequencyBias: {
        type: "float",
        label: "Fine detail loss",
        default: 1.2,
        min: 0,
        max: 3,
        step: 0.01,
      },
      chromaLoss: {
        type: "float",
        label: "Chroma subsampling",
        default: 0.8,
        min: 0,
        max: 1,
        step: 0.01,
      },
      colorBleed: {
        type: "float",
        label: "Color bleed",
        default: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      },
      amount: {
        type: "float",
        label: "Amount",
        default: 0.85,
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
        name: "encoded",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["sampled", "storage"],
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
        id: "ycbcr-dct",
        kind: "compute",
        reads: ["source"],
        output: "encoded",
        dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
        wgsl: codecComputeWgsl,
      },
      {
        id: "color-codec-resolve",
        kind: "render",
        reads: ["source", "encoded"],
        output: "color",
        wgsl: codecResolveWgsl,
      },
    ],
    output: "color",
    provenance: {
      origin: "design-original",
      note: "Original RGB-to-YCbCr 8×8 luma DCT quantization with inverse reconstruction, alpha-weighted 4:2:0 chroma cells, and bounded neighboring chroma bleed. No temporal compression is claimed.",
    },
  },
];

export const FILM_CODEC_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-al-film-warm-print",
    name: "Warm print",
    definitionId: "an-native-owned-al-film-response",
    definitionVersion: 1,
    placement: "layer",
    params: {
      exposure: -0.12,
      toe: 0.46,
      shoulder: 0.62,
      channelCoupling: 0.52,
      profile: 0.1,
      gateWeave: 0.75,
      grain: 0.48,
      amount: 0.9,
      patternSeed: 24,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-al-film-cool-negative",
    name: "Cool negative",
    definitionId: "an-native-owned-al-film-response",
    definitionVersion: 1,
    placement: "layer",
    params: {
      exposure: 0.18,
      toe: 0.24,
      shoulder: 0.38,
      channelCoupling: 0.3,
      profile: 0.92,
      gateWeave: 1.3,
      grain: 0.32,
      amount: 0.86,
      patternSeed: 63,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-al-codec-soft-chroma",
    name: "Soft chroma",
    definitionId: "an-native-owned-al-color-codec",
    definitionVersion: 1,
    placement: "layer",
    params: {
      quantization: 0.045,
      frequencyBias: 0.8,
      chromaLoss: 0.55,
      colorBleed: 0.35,
      amount: 0.72,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-al-codec-heavy-compression",
    name: "Heavy compression",
    definitionId: "an-native-owned-al-color-codec",
    definitionVersion: 1,
    placement: "layer",
    params: {
      quantization: 0.16,
      frequencyBias: 2.25,
      chromaLoss: 1,
      colorBleed: 0.85,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
