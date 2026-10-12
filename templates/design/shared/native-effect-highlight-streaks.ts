import {
  NATIVE_GLOBAL_BINDINGS,
  NATIVE_RENDER_GLOBALS,
} from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const computeWgsl = `${NATIVE_GLOBAL_BINDINGS}
@group(0) @binding(4) var<storage, read_write> anchors: array<u32>;
var<workgroup> scores: array<f32, 192>;

fn streakBoundary(bucket: u32, scale: u32, shift: u32, width: u32) -> u32 {
  // The host bounds bucket to 4096, so both 16-bit partial products fit u32.
  let lowProduct = bucket * (scale & 65535u);
  let highProduct = bucket * (scale >> 16u);
  let low = lowProduct + ((highProduct & 65535u) << 16u);
  let high = (highProduct >> 16u) + select(0u, 1u, low < lowProduct);
  let roundedLow = low + ((1u << (shift - 1u)) - 1u);
  let roundedHigh = high + select(0u, 1u, roundedLow < low);
  return min((roundedLow >> shift) | (roundedHigh << (32u - shift)), width);
}

@compute @workgroup_size(64)
fn cs(@builtin(workgroup_id) tile: vec3u, @builtin(local_invocation_index) lane: u32) {
  let extent = textureDimensions(sourceTexture, 0);
  let density = bitcast<u32>(globals.clock.z);
  let exponent = (density >> 23u) & 255u;
  var shift = 0u;
  var scale = 0u;
  var identity = exponent < 123u;
  if (!identity) {
    shift = 150u - exponent;
    scale = ((density & 8388607u) | 8388608u) * u32(globals.params[0].x);
    identity = scale < (1u << shift);
  }
  let origin = i32(tile.x * 64u) - 64;
  // A <=64-pixel run can cross either edge of the 64-pixel output tile.
  for (var stage = lane; stage < 192u; stage += 64u) {
    scores[stage] = -1.0;
    let sourceX = origin + i32(stage);
    if (!identity && sourceX >= 0 && sourceX < i32(extent.x)) {
      let sample = textureLoad(sourceTexture, vec2i(sourceX, i32(tile.y)), 0);
      if (sample.a > 0.00001) {
        let intensity = dot(sample.rgb / sample.a, vec3f(0.2126, 0.7152, 0.0722));
        if (intensity >= globals.params[1].x) {
          scores[stage] = intensity;
        }
      }
    }
  }
  workgroupBarrier();
  let pixelX = tile.x * 64u + lane;
  if (identity || pixelX >= extent.x) { return; }
  var low = 0u;
  var high = extent.x + 1u;
  while (low + 1u < high) {
    let middle = low + (high - low) / 2u;
    if (streakBoundary(middle, scale, shift, extent.x) <= pixelX) { low = middle; }
    else { high = middle; }
  }
  let start = streakBoundary(low, scale, shift, extent.x);
  let end = streakBoundary(low + 1u, scale, shift, extent.x);
  var bestScore = -1.0;
  var anchor = 0u;
  for (var sourceX = start; sourceX < end; sourceX += 1u) {
    let intensity = scores[u32(i32(sourceX) - origin)];
    if (intensity > bestScore) {
      bestScore = intensity;
      anchor = sourceX + 1u;
    }
  }
  let linear = tile.y * extent.x + pixelX;
  anchors[linear] = anchor;
}
`;

const resolveWgsl = `${NATIVE_RENDER_GLOBALS}
@group(0) @binding(4) var<storage, read> anchors: array<u32>;
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let extent = vec2i(textureDimensions(sourceTexture, 0));
  let pixel = clamp(vec2i(floor(input.uv * vec2f(extent))), vec2i(0), extent - vec2i(1));
  let original = textureLoad(sourceTexture, pixel, 0);
  let amount = globals.params[2].x;
  if (amount <= 0.0 || original.a <= 0.00001) { return original; }
  let linear = u32(pixel.y) * u32(extent.x) + u32(pixel.x);
  let anchor = anchors[linear];
  if (anchor == 0u) { return original; }
  let chosen = textureLoad(sourceTexture, vec2i(i32(anchor - 1u), pixel.y), 0);
  let highlight = (chosen.rgb / chosen.a) * original.a;
  return vec4f(mix(original.rgb, highlight, amount), original.a);
}
`;

export const HIGHLIGHT_STREAKS_EFFECT: EffectDefinition = {
  id: "an-native-highlight-streaks",
  name: "Highlight Streaks",
  version: 1,
  kind: "processor",
  placements: ["layer"],
  properties: {
    runWidth: {
      type: "int",
      label: "Run width",
      default: 8,
      min: 1,
      max: 16,
      step: 1,
      unit: "px",
    },
    threshold: {
      type: "float",
      label: "Threshold",
      default: 0.65,
      min: 0,
      max: 1,
      step: 0.01,
    },
    amount: {
      type: "float",
      label: "Amount",
      default: 0.75,
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
      name: "anchors",
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
    bufferResource: "anchors",
    sharedBytes: 768,
  },
  passes: [
    {
      id: "select-highlights",
      kind: "compute",
      reads: ["source"],
      output: "anchors",
      dispatch: {
        elements: "source-grid",
        workgroupSize: [64, 1, 1],
      },
      wgsl: computeWgsl,
    },
    {
      id: "resolve-streaks",
      kind: "render",
      reads: ["source", "anchors"],
      output: "color",
      wgsl: resolveWgsl,
    },
  ],
  output: "color",
  provenance: { origin: "design-original" },
};

export const HIGHLIGHT_STREAKS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-highlight-streaks-short-glints",
    name: "Short glints",
    definitionId: HIGHLIGHT_STREAKS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { runWidth: 4, threshold: 0.75, amount: 0.45 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-highlight-streaks-long-trails",
    name: "Long trails",
    definitionId: HIGHLIGHT_STREAKS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { runWidth: 16, threshold: 0.45, amount: 1 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
