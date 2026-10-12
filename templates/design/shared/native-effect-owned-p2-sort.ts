import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import {
  propertySlots,
  type EffectDefinition,
  type EffectProperty,
} from "./native-effects";

const float = (
  label: string,
  value: number,
  min: number,
  max: number,
  unit?: string,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.01,
  ...(unit ? { unit } : {}),
});
function processor(
  id: string,
  name: string,
  version: number,
  properties: Record<string, EffectProperty>,
  code: (property: (name: string) => string) => string,
  note: string,
): EffectDefinition {
  const slots = new Map<string, number>();
  let count = 0;
  for (const [key, property] of Object.entries(properties)) {
    slots.set(key, count);
    count += propertySlots(property);
  }
  if (count > 32) throw new Error(`Uniform budget exceeded by ${id}`);
  const property = (key: string): string => {
    const slot = slots.get(key);
    if (slot === undefined) throw new Error(`Unknown uniform ${key}`);
    return `globals.params[${slot}]`;
  };
  return {
    id,
    name,
    version,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties,
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
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    output: "color",
    passes: [
      {
        id: "render",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: NATIVE_RENDER_GLOBALS + code(property),
      },
    ],
    provenance: { origin: "design-original", note },
  };
}

export const INTENSITY_RUN_SORT_EFFECT = processor(
  "an-native-owned-p-intensity-run-sort",
  "Intensity Run Sort",
  5,
  {
    threshold: float("Threshold", 0.35, 0, 1),
    blockLength: {
      type: "int",
      label: "Run width",
      default: 8,
      min: 2,
      max: 16,
      step: 1,
      unit: "px",
    },
    order: {
      type: "enum",
      label: "Order",
      default: "ascending",
      options: ["ascending", "descending"],
    },
    amount: float("Amount", 1, 0, 1),
  },
  (p) => `
fn sortMultiplyWords(a: u32, b: u32) -> vec2u {
  let aLow = a & 65535u;
  let aHigh = a >> 16u;
  let bLow = b & 65535u;
  let bHigh = b >> 16u;
  let lowProduct = aLow * bLow;
  let crossProduct = aLow * bHigh;
  let middle = (lowProduct >> 16u) + aHigh * bLow + (crossProduct & 65535u);
  return vec2u((lowProduct & 65535u) | (middle << 16u), aHigh * bHigh + (crossProduct >> 16u) + (middle >> 16u));
}
fn sortBoundary(bucket: u32, scale: u32, shift: u32, extent: u32) -> u32 {
  let product = sortMultiplyWords(bucket, scale);
  let rounded = product.x + ((1u << (shift - 1u)) - 1u);
  let high = product.y + select(0u, 1u, rounded < product.x);
  return min((rounded >> shift) | (high << (32u - shift)), extent);
}
fn sortBucket(pixel: u32, scale: u32, shift: u32, extent: u32) -> u32 {
  var low = 0u;
  var high = extent + 1u;
  loop {
    if (low + 1u >= high) { break; }
    let middle = low + (high - low) / 2u;
    if (sortBoundary(middle, scale, shift, extent) <= pixel) { low = middle; }
    else { high = middle; }
  }
  return low;
}
fn sortLuminance(color: vec4f) -> f32 {
  return dot(color.rgb / color.a, vec3f(0.2126, 0.7152, 0.0722));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let extent = vec2i(textureDimensions(sourceTexture, 0));
  let pixel = clamp(vec2i(floor(input.uv * vec2f(extent))), vec2i(0), extent - vec2i(1));
  let original = textureLoad(sourceTexture, pixel, 0);
  if (${p("amount")}.x <= 0.0) { return original; }
  let densityBits = bitcast<u32>(globals.clock.z);
  let exponent = (densityBits >> 23u) & 255u;
  if (exponent < 123u) { return original; }
  let shift = 150u - exponent;
  let scale = ((densityBits & 8388607u) | 8388608u) * u32(${p("blockLength")}.x);
  if (scale < (1u << shift)) { return original; }
  let bucket = sortBucket(u32(pixel.x), scale, shift, u32(extent.x));
  let start = i32(sortBoundary(bucket, scale, shift, u32(extent.x)));
  let end = i32(sortBoundary(bucket + 1u, scale, shift, u32(extent.x)));
  let count = end - start;
  let localIndex = pixel.x - start;
  var colors: array<vec4f, 64>;
  var intensities: array<f32, 64>;
  var eligible: array<bool, 64>;
  for (var i = 0; i < 64; i += 1) {
    if (i >= count) { break; }
    let color = textureLoad(sourceTexture, vec2i(start + i, pixel.y), 0);
    colors[i] = color;
    eligible[i] = color.a > 0.00001;
    if (eligible[i]) { intensities[i] = sortLuminance(color); }
    eligible[i] = eligible[i] && intensities[i] >= ${p("threshold")}.x;
  }
  if (!eligible[localIndex]) { return original; }
  var first = localIndex;
  var last = localIndex;
  for (var distance = 1; distance < 64; distance += 1) {
    let candidate = localIndex - distance;
    if (candidate < 0) { break; }
    if (!eligible[candidate]) { break; }
    first = candidate;
  }
  for (var distance = 1; distance < 64; distance += 1) {
    let candidate = localIndex + distance;
    if (candidate >= count) { break; }
    if (!eligible[candidate]) { break; }
    last = candidate;
  }
  let requestedRank = localIndex - first;
  let descending = u32(${p("order")}.x) == 1u;
  var chosen = original;
  for (var candidate = first; candidate <= last; candidate += 1) {
    var rank = 0;
    for (var other = first; other <= last; other += 1) {
      let before = select(intensities[other] < intensities[candidate], intensities[other] > intensities[candidate], descending);
      let tieBefore = intensities[other] == intensities[candidate] && other < candidate;
      if (before || tieBefore) { rank += 1; }
    }
    if (rank == requestedRank) { chosen = colors[candidate]; break; }
  }
  return mix(original, chosen, ${p("amount")}.x);
}
`,
  "CSS blocks use exact integer endpoints from encoded f32 layout density. Stable RGBA ranks preserve contiguous runs; physical spans below one texel are identity. At DPR 4 the maximum run has 64 texels.",
);
