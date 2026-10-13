import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const contoursWgsl = `${NATIVE_GRAPH_GLOBALS}
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
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
  let amount = globals.params[9].x;
  let straight = source.rgb / max(source.a, 0.00001);
  let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  let mode = globals.params[0].x;
  var value = select(clamp(luma, 0.0, 1.0), clamp(source.a, 0.0, 1.0), mode > 0.5);
  if (globals.params[4].x > 0.5) { value = 1.0 - value; }
  let distributed = pow(value, globals.params[3].x);
  let phase = distributed * globals.params[1].x;
  let distance = abs(fract(phase + 0.5) - 0.5);
  let derivative = max(fwidth(phase), 0.00001) * globals.clock.z;
  if (amount <= 0.0 || source.a <= 0.00001) { return source; }
  let halfWidth = derivative * globals.params[2].x * 0.5;
  let feather = max(derivative * globals.params[5].x, 0.00001);
  let line = 1.0 - smoothstep(max(halfWidth - feather, 0.0), halfWidth + feather, distance);
  let sourceMode = globals.params[6].x < 0.5;
  let ink = globals.params[7];
  let paper = globals.params[8];
  let customStraight = mix(paper.rgb, ink.rgb, line);
  let sourceStraight = straight * (0.18 + line * 1.12);
  let stylized = select(customStraight, sourceStraight, sourceMode);
  let customAlpha = mix(paper.a, ink.a, line);
  let coverage = source.a * select(customAlpha, 1.0, sourceMode);
  let processed = vec4f(stylized * coverage, coverage);
  return mix(source, processed, amount);
}`;

export const SOURCE_CONTOURS_EFFECT: EffectDefinition = {
  id: "an-native-owned-bv-source-contours",
  name: "Source Contours",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    channel: {
      type: "enum",
      label: "Contour source",
      default: "Luminance",
      options: ["Luminance", "Alpha"],
    },
    levels: {
      type: "int",
      label: "Contour levels",
      default: 12,
      min: 2,
      max: 64,
      step: 1,
    },
    lineWidth: {
      type: "float",
      label: "Line width",
      default: 2,
      min: 0.2,
      max: 12,
      step: 0.1,
    },
    distribution: {
      type: "float",
      label: "Level distribution",
      default: 1,
      min: 0.3,
      max: 3,
      step: 0.01,
    },
    invert: { type: "bool", label: "Invert levels", default: false },
    softness: {
      type: "float",
      label: "Line softness",
      default: 0.65,
      min: 0.05,
      max: 6,
      step: 0.05,
    },
    colorMode: {
      type: "enum",
      label: "Color mode",
      default: "Source",
      options: ["Source", "Custom"],
    },
    lineColor: {
      type: "color",
      label: "Contour color",
      default: color([0.91, 0.96, 1]),
    },
    backgroundColor: {
      type: "color",
      label: "Background color",
      default: color([0.04, 0.09, 0.16]),
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
      id: "trace-source-contours",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl: contoursWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original derivative-aware contours from live source luminance or alpha with CSS-pixel line width and premultiplied source/custom color modes.",
  },
};

export const SOURCE_CONTOURS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bv-topographic-ink",
    name: "Topographic Ink",
    definitionId: SOURCE_CONTOURS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      channel: "Luminance",
      levels: 16,
      lineWidth: 1.5,
      distribution: 0.75,
      invert: false,
      softness: 0.5,
      colorMode: "Custom",
      lineColor: color([0.87, 0.94, 1]),
      backgroundColor: color([0.035, 0.075, 0.13]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bv-alpha-elevation",
    name: "Alpha Elevation",
    definitionId: SOURCE_CONTOURS_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      channel: "Alpha",
      levels: 9,
      lineWidth: 3.2,
      distribution: 1.6,
      invert: true,
      softness: 1.1,
      colorMode: "Source",
      lineColor: color([0.95, 0.38, 0.18]),
      backgroundColor: color([0.055, 0.03, 0.02]),
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];

export const SOURCE_CONTOURS_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  SOURCE_CONTOURS_PRESETS.map((preset) => [preset.id, preset.id]),
);
