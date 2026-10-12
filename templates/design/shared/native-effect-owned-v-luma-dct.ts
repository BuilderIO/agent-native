import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeWgsl = `${NATIVE_GLOBAL_BINDINGS}
@group(0) @binding(4) var<storage, read_write> rebuiltLuma: array<f32>;
var<workgroup> tileLuma: array<f32, 64>;
var<workgroup> coefficients: array<f32, 64>;

fn basis(frequency: u32, coordinate: u32) -> f32 {
  let normalization = select(0.5, 0.3535533905932738, frequency == 0u);
  return normalization * cos((2.0 * f32(coordinate) + 1.0) * f32(frequency) * 0.19634954084936207);
}

@compute @workgroup_size(8, 8, 1)
fn cs(
  @builtin(workgroup_id) tile: vec3u,
  @builtin(local_invocation_id) lane: vec3u,
) {
  let extent = textureDimensions(sourceTexture, 0);
  let origin = tile.xy * 8u;
  let pixel = origin + lane.xy;
  let inside = pixel.x < extent.x && pixel.y < extent.y;
  let complete = origin.x + 8u <= extent.x && origin.y + 8u <= extent.y;
  if (!complete || globals.params[0].x <= 0.0) {
    if (inside) {
      let source = textureLoad(sourceTexture, vec2i(pixel), 0);
      rebuiltLuma[pixel.y * extent.x + pixel.x] = dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722));
    }
    return;
  }
  let localIndex = lane.y * 8u + lane.x;
  let ownPixel = textureLoad(sourceTexture, vec2i(pixel), 0);
  tileLuma[localIndex] = dot(ownPixel.rgb, vec3f(0.2126, 0.7152, 0.0722));
  workgroupBarrier();

  let frequency = lane.xy;
  var coefficient = 0.0;
  for (var y = 0u; y < 8u; y += 1u) {
    for (var x = 0u; x < 8u; x += 1u) {
      let luminance = tileLuma[y * 8u + x];
      coefficient += luminance * basis(frequency.x, x) * basis(frequency.y, y);
    }
  }
  let frequencyWeight = 1.0 + globals.params[1].x * f32(frequency.x + frequency.y) / 14.0;
  let step = max(globals.params[0].x * frequencyWeight, 0.000001);
  coefficients[localIndex] = floor(coefficient / step + 0.5) * step;
  workgroupBarrier();

  var luminance = 0.0;
  for (var ky = 0u; ky < 8u; ky += 1u) {
    for (var kx = 0u; kx < 8u; kx += 1u) {
      luminance += coefficients[ky * 8u + kx] * basis(kx, lane.x) * basis(ky, lane.y);
    }
  }
  rebuiltLuma[pixel.y * extent.x + pixel.x] = luminance;
}
`;

const resolveWgsl = `${NATIVE_RENDER_GLOBALS}
@group(0) @binding(4) var<storage, read> rebuiltLuma: array<f32>;
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let extent = vec2i(textureDimensions(sourceTexture, 0));
  let pixel = clamp(vec2i(floor(input.uv * vec2f(extent))), vec2i(0), extent - vec2i(1));
  let source = textureLoad(sourceTexture, pixel, 0);
  if (globals.params[0].x <= 0.0 || globals.params[2].x <= 0.0 || source.a <= 0.0) { return source; }
  let index = u32(pixel.y) * u32(extent.x) + u32(pixel.x);
  let originalLuma = dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let adjustment = rebuiltLuma[index] - originalLuma;
  let crushed = clamp(source.rgb + vec3f(adjustment), vec3f(0.0), vec3f(source.a));
  return vec4f(mix(source.rgb, crushed, globals.params[2].x), source.a);
}
`;

export const LUMA_DCT_EIGHT_EFFECT: EffectDefinition = {
  id: "an-native-owned-v-luma-dct-eight",
  name: "8×8 Luma DCT",
  version: 1,
  kind: "processor",
  placements: ["layer"],
  properties: {
    quantization: {
      type: "float",
      label: "Coefficient step",
      default: 0.06,
      min: 0,
      max: 0.3,
      step: 0.005,
    },
    frequencyBias: {
      type: "float",
      label: "Fine detail loss",
      default: 1,
      min: 0,
      max: 3,
      step: 0.01,
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
      name: "rebuiltLuma",
      kind: "buffer",
      size: "source",
      sourceBytesPerPixel: 4,
      usage: ["storage", "copy-dst"],
    },
    {
      name: "color",
      kind: "texture-2d",
      size: "viewport",
      format: "rgba16float",
      usage: ["render", "sampled"],
    },
  ],
  statelessCompute: {
    abi: "source-buffer-v1",
    bufferResource: "rebuiltLuma",
    sharedBytes: 512,
  },
  passes: [
    {
      id: "dct-eight",
      kind: "compute",
      reads: ["source"],
      output: "rebuiltLuma",
      dispatch: { elements: "source-grid", workgroupSize: [8, 8, 1] },
      wgsl: computeWgsl,
    },
    {
      id: "resolve-luma",
      kind: "render",
      reads: ["source", "rebuiltLuma"],
      output: "color",
      wgsl: resolveWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original 8×8 luminance DCT with frequency-weighted quantization and premultiplied RGB reconstruction. Source alpha is preserved; no chroma subsampling or temporal lag.",
  },
};

export const LUMA_DCT_EIGHT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-v-luma-dct-eight-fine",
    name: "Fine luma blocks",
    definitionId: LUMA_DCT_EIGHT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { quantization: 0.035, frequencyBias: 0.5, amount: 0.7 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-v-luma-dct-eight-crushed",
    name: "Crushed luma blocks",
    definitionId: LUMA_DCT_EIGHT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { quantization: 0.14, frequencyBias: 2, amount: 1 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
