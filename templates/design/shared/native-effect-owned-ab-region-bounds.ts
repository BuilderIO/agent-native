import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const analyzeWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(18) var<storage, read_write> regions: array<vec4f>;

@compute @workgroup_size(256, 1, 1)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  let grid = u32(clamp(globals.params[2].x, 1.0, 8.0));
  let region = invocation.x;
  if (region >= grid * grid) { return; }

  let cell = vec2f(f32(region % grid), f32(region / grid));
  let origin = cell / f32(grid);
  let extent = 1.0 / f32(grid);
  let sampleHalfStep = 0.5 * extent / 8.0;
  let detection = u32(clamp(globals.params[0].x, 0.0, 2.0));
  let threshold = clamp(globals.params[1].x, 0.0, 1.0);
  let referenceColor = globals.params[4].rgb;
  var low = vec2f(1.0);
  var high = vec2f(0.0);
  var hits = 0.0;
  var weightedColor = vec3f(0.0);
  var alphaSum = 0.0;

  for (var y = 0; y < 8; y += 1) {
    for (var x = 0; x < 8; x += 1) {
      let uv = origin + (vec2f(f32(x), f32(y)) + vec2f(0.5)) * extent / 8.0;
      let sample = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
      let visible = sample.a > 0.00001;
      let straight = sample.rgb / max(sample.a, 0.00001);
      var detected = false;
      if (detection == 0u) {
        detected = visible && sample.a >= threshold;
      } else if (detection == 1u) {
        detected = visible && dot(straight, vec3f(0.2126, 0.7152, 0.0722)) >= threshold;
      } else {
        detected = visible && distance(straight, referenceColor) <= threshold;
      }
      if (detected) {
        low = min(low, uv - vec2f(sampleHalfStep));
        high = max(high, uv + vec2f(sampleHalfStep));
        hits += 1.0;
        weightedColor += sample.rgb;
        alphaSum += sample.a;
      }
    }
  }

  let coverage = hits / 64.0;
  let valid = hits > 0.0 && coverage >= clamp(globals.params[3].x, 0.0, 1.0);
  let base = region * 3u;
  regions[base] = vec4f(low, high);
  regions[base + 1u] = vec4f(select(0.0, 1.0, valid), f32(region), coverage, 0.0);
  regions[base + 2u] = vec4f(weightedColor / max(alphaSum, 0.00001), 1.0);
}`;

const renderWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> regions: array<vec4f>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(triangle[vertexIndex], 0.0, 1.0);
  output.uv = triangle[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = clamp(globals.params[9].x, 0.0, 1.0);
  if (amount <= 0.0 || source.a <= 0.00001) { return source; }

  let grid = u32(clamp(globals.params[2].x, 1.0, 8.0));
  let cell = min(vec2u(input.uv * f32(grid)), vec2u(grid - 1u));
  let region = cell.y * grid + cell.x;
  let base = region * 3u;
  let bounds = regions[base];
  let info = regions[base + 1u];
  if (info.x < 0.5 || input.uv.x < bounds.x || input.uv.y < bounds.y ||
      input.uv.x > bounds.z || input.uv.y > bounds.w) { return source; }

  let mode = u32(clamp(globals.params[5].x, 0.0, 1.0));
  var result = source.rgb;
  if (mode == 1u) {
    let visibility = clamp(globals.params[8].x, 0.0, 1.0);
    let mean = regions[base + 2u].rgb * source.a;
    result = mix(result, mean, 1.0 - visibility);
  }

  let halfStroke = 0.5 * clamp(globals.params[6].x, 0.5, 12.0) * globals.viewport.zw;
  let edgeX = min(input.uv.x - bounds.x, bounds.z - input.uv.x);
  let edgeY = min(input.uv.y - bounds.y, bounds.w - input.uv.y);
  if (edgeX <= halfStroke.x || edgeY <= halfStroke.y) {
    let ink = globals.params[7];
    result = mix(result, ink.rgb * source.a, clamp(ink.a, 0.0, 1.0));
  }
  return vec4f(mix(source.rgb, result, amount), source.a);
}`;

export const REGION_BOUNDS_EFFECT: EffectDefinition = {
  id: "an-native-owned-ab-region-bounds",
  name: "Region Bounds",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    detection: {
      type: "enum",
      label: "Detection",
      default: "Alpha",
      options: ["Alpha", "Luminance", "Color"],
    },
    threshold: {
      type: "float",
      label: "Threshold",
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
    },
    grid: {
      type: "int",
      label: "Grid",
      default: 4,
      min: 1,
      max: 8,
      step: 1,
    },
    minimumCoverage: {
      type: "float",
      label: "Minimum coverage",
      default: 0.06,
      min: 0,
      max: 1,
      step: 0.01,
    },
    referenceColor: {
      type: "color",
      label: "Reference color",
      default: { space: "srgb", components: [1, 1, 1], alpha: 1 },
      visibleWhen: { property: "detection", equals: "Color" },
    },
    mode: {
      type: "enum",
      label: "Mode",
      default: "Outlines",
      options: ["Outlines", "Mosaic"],
    },
    strokeWidth: {
      type: "float",
      label: "Stroke width",
      default: 2,
      min: 0.5,
      max: 12,
      step: 0.5,
      unit: "px",
    },
    strokeColor: {
      type: "color",
      label: "Stroke color",
      default: { space: "srgb", components: [0.05, 0.9, 0.75], alpha: 1 },
    },
    sourceVisibility: {
      type: "float",
      label: "Source visibility",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      visibleWhen: { property: "mode", equals: "Mosaic" },
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
      name: "regions",
      kind: "buffer",
      size: "fixed",
      byteLength: 3072,
      usage: ["storage"],
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      size: "viewport",
      usage: ["sampled", "render"],
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "sample-region-bounds",
      kind: "compute",
      reads: ["source"],
      output: "regions",
      dispatch: { elements: "output-buffer", workgroupSize: [256, 1, 1] },
      wgsl: analyzeWgsl,
    },
    {
      id: "draw-region-bounds",
      kind: "render",
      reads: ["source", "regions"],
      output: "color",
      wgsl: renderWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original bounded grid analysis of source alpha, luminance, or color. Each cell derives sampled bounds and coverage on the GPU; it does not identify semantic objects. The render keeps source alpha and returns the exact source at zero Amount.",
  },
};

export const REGION_BOUNDS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-ab-region-bounds-fine-alpha-outlines",
    name: "Fine alpha outlines",
    definitionId: REGION_BOUNDS_EFFECT.id,
    definitionVersion: REGION_BOUNDS_EFFECT.version,
    placement: "layer",
    params: {
      detection: "Alpha",
      threshold: 0.2,
      grid: 6,
      minimumCoverage: 0.05,
      strokeWidth: 1.5,
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ab-region-bounds-bold-luminance-cells",
    name: "Bold luminance cells",
    definitionId: REGION_BOUNDS_EFFECT.id,
    definitionVersion: REGION_BOUNDS_EFFECT.version,
    placement: "layer",
    params: {
      detection: "Luminance",
      threshold: 0.48,
      grid: 4,
      minimumCoverage: 0.08,
      mode: "Mosaic",
      strokeWidth: 4,
      sourceVisibility: 0.2,
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
