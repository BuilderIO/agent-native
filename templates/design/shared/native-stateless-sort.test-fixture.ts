import type { EffectDefinition } from "./native-effects";

const COMPUTE =
  "\nstruct Globals {\n  viewport: vec4f,\n  clock: vec4f,\n  params: array<vec4f, 32>,\n};\n@group(0) @binding(0) var<uniform> globals: Globals;\n@group(0) @binding(1) var effectSampler: sampler;\n@group(0) @binding(2) var sourceTexture: texture_2d<f32>;\n@group(0) @binding(3) var maskTexture: texture_2d<f32>;\n@group(0) @binding(4) var<storage, read_write> sortOffsets: array<atomic<u32>>;\nfn sortMultiplyWords(a: u32, b: u32) -> vec2u {\n  let aLow = a & 65535u;\n  let aHigh = a >> 16u;\n  let bLow = b & 65535u;\n  let bHigh = b >> 16u;\n  let lowProduct = aLow * bLow;\n  let crossProduct = aLow * bHigh;\n  let middle = (lowProduct >> 16u) + aHigh * bLow + (crossProduct & 65535u);\n  return vec2u((lowProduct & 65535u) | (middle << 16u), aHigh * bHigh + (crossProduct >> 16u) + (middle >> 16u));\n}\nfn sortBoundary(bucket: u32, scale: u32, shift: u32, extent: u32) -> u32 {\n  let product = sortMultiplyWords(bucket, scale);\n  let rounded = product.x + ((1u << (shift - 1u)) - 1u);\n  let high = product.y + select(0u, 1u, rounded < product.x);\n  return min((rounded >> shift) | (high << (32u - shift)), extent);\n}\nfn sortBucket(pixel: u32, scale: u32, shift: u32, extent: u32) -> u32 {\n  var low = 0u;\n  var high = extent + 1u;\n  loop {\n    if (low + 1u >= high) { break; }\n    let middle = low + (high - low) / 2u;\n    if (sortBoundary(middle, scale, shift, extent) <= pixel) { low = middle; }\n    else { high = middle; }\n  }\n  return low;\n}\n\nvar<workgroup> intensities: array<f32, 64>;\nvar<workgroup> eligible: array<u32, 64>;\nfn sortLuminance(color: vec4f) -> f32 {\n  return dot(color.rgb / color.a, vec3f(0.2126, 0.7152, 0.0722));\n}\n@compute @workgroup_size(64)\nfn cs(@builtin(workgroup_id) block: vec3u, @builtin(local_invocation_index) lane: u32) {\n  let extent = textureDimensions(sourceTexture, 0);\n  let densityBits = bitcast<u32>(globals.clock.z);\n  let exponent = (densityBits >> 23u) & 255u;\n  // The host uses the original render identity branch outside this dispatch domain.\n  let shift = 150u - exponent;\n  let scale = ((densityBits & 8388607u) | 8388608u) * u32(globals.params[1].x);\n  let start = sortBoundary(block.x, scale, shift, extent.x);\n  let end = sortBoundary(block.x + 1u, scale, shift, extent.x);\n  let count = end - start;\n  eligible[lane] = 0u;\n  intensities[lane] = 0.0;\n  if (lane < count) {\n    let color = textureLoad(sourceTexture, vec2i(i32(start + lane), i32(block.y)), 0);\n    if (color.a > 0.00001) {\n      intensities[lane] = sortLuminance(color);\n      eligible[lane] = select(0u, 1u, intensities[lane] >= globals.params[0].x);\n    }\n  }\n  workgroupBarrier();\n  if (lane >= count) { return; }\n  var destination = lane;\n  if (eligible[lane] == 1u) {\n    var first = lane;\n    var last = lane;\n    for (var distance = 1u; distance < 64u; distance += 1u) {\n      if (distance > lane) { break; }\n      let other = lane - distance;\n      if (eligible[other] == 0u) { break; }\n      first = other;\n    }\n    for (var distance = 1u; distance < 64u; distance += 1u) {\n      let other = lane + distance;\n      if (other >= count) { break; }\n      if (eligible[other] == 0u) { break; }\n      last = other;\n    }\n    let descending = u32(globals.params[2].x) == 1u;\n    var rank = 0u;\n    for (var other = first; other <= last; other += 1u) {\n      let before = select(intensities[other] < intensities[lane], intensities[other] > intensities[lane], descending);\n      let tieBefore = intensities[other] == intensities[lane] && other < lane;\n      if (before || tieBefore) { rank += 1u; }\n    }\n    destination = first + rank;\n  }\n  let pixel = block.y * extent.x + start + destination;\n  let encodedOffset = u32(i32(lane) - i32(destination) + 64) | select(0u, 128u, eligible[lane] == 1u);\n  atomicOr(&sortOffsets[pixel >> 2u], encodedOffset << ((pixel & 3u) * 8u));\n}\n";
const RESOLVE =
  "\nstruct Globals {\n  viewport: vec4f,\n  clock: vec4f,\n  params: array<vec4f, 32>,\n};\n@group(0) @binding(0) var<uniform> globals: Globals;\n@group(0) @binding(1) var effectSampler: sampler;\n@group(0) @binding(2) var sourceTexture: texture_2d<f32>;\n@group(0) @binding(3) var maskTexture: texture_2d<f32>;\nstruct VertexOutput {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n};\n@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {\n  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var output: VertexOutput;\n  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);\n  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);\n  return output;\n}\n\n@group(0) @binding(4) var<storage, read> sortOffsets: array<u32>;\n@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {\n  let extent = vec2i(textureDimensions(sourceTexture, 0));\n  let pixel = clamp(vec2i(floor(input.uv * vec2f(extent))), vec2i(0), extent - vec2i(1));\n  let original = textureLoad(sourceTexture, pixel, 0);\n  if (globals.params[3].x <= 0.0) { return original; }\n  let linear = u32(pixel.y) * u32(extent.x) + u32(pixel.x);\n  let encodedOffset = (sortOffsets[linear >> 2u] >> ((linear & 3u) * 8u)) & 255u;\n  if ((encodedOffset & 128u) == 0u) { return original; }\n  let chosen = textureLoad(sourceTexture, vec2i(pixel.x + i32(encodedOffset & 127u) - 64, pixel.y), 0);\n  return mix(original, chosen, globals.params[3].x);\n}\n";

export const STATELESS_SORT_TEST_DEFINITION: EffectDefinition = {
  id: "qa-source-block-sort",
  name: "Source block sort test",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  provenance: { origin: "design-original" },
  properties: {
    threshold: {
      type: "float",
      label: "Threshold",
      default: 0.35,
      min: 0,
      max: 1,
    },
    blockLength: {
      type: "int",
      label: "Run width",
      default: 8,
      min: 2,
      max: 16,
      unit: "px",
    },
    order: {
      type: "enum",
      label: "Order",
      default: "ascending",
      options: ["ascending", "descending"],
    },
    amount: { type: "float", label: "Amount", default: 1, min: 0, max: 1 },
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
      name: "indices",
      kind: "buffer",
      size: "source",
      sourceBytesPerPixel: 1,
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
    bufferResource: "indices",
    sharedBytes: 512,
    subpixelBlocks: "source-identity",
  },
  passes: [
    {
      id: "rank",
      kind: "compute",
      reads: ["source"],
      output: "indices",
      dispatch: {
        elements: "source-row-blocks",
        workgroupSize: [64, 1, 1],
        blockProperty: "blockLength",
      },
      wgsl: COMPUTE,
    },
    {
      id: "resolve",
      kind: "render",
      reads: ["source", "indices"],
      output: "color",
      wgsl: RESOLVE,
    },
  ],
  output: "color",
};
