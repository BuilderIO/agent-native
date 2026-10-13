import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn sourceLuma(uv: vec2f) -> f32 {
  let source = textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  let straight = source.rgb / max(source.a, 0.00001);
  return dot(max(straight, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[7].x;
  if (amount <= 0.0) { return original; }
  let cssToUv = globals.clock.z * globals.viewport.zw;
  let gradient = vec2f(
    sourceLuma(input.uv + vec2f(cssToUv.x, 0.0)) - sourceLuma(input.uv - vec2f(cssToUv.x, 0.0)),
    sourceLuma(input.uv + vec2f(0.0, cssToUv.y)) - sourceLuma(input.uv - vec2f(0.0, cssToUv.y))
  ) * 0.5;
  let displacedUv = input.uv - gradient * globals.params[4].x * cssToUv;
  var sampled = vec4f(0.0);
  if (all(displacedUv >= vec2f(0.0)) && all(displacedUv <= vec2f(1.0))) {
    sampled = textureSampleLevel(sourceTexture, effectSampler, displacedUv, 0.0);
  }
  let luma = dot(max(sampled.rgb / max(sampled.a, 0.00001), vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722));
  let cssPoint = input.uv * globals.viewport.xy / globals.clock.z;
  let spacing = globals.params[1].x;
  let angle = globals.params[3].x;
  let direction = vec2f(cos(angle), sin(angle));
  let centered = cssPoint - globals.viewport.xy / (2.0 * globals.clock.z);
  var phase = dot(cssPoint, direction) / spacing;
  if (globals.params[0].x > 0.5) {
    let radial = length(centered) / spacing;
    let angular = atan2(centered.y, centered.x) / 6.2831853;
    phase = radial + angular * 2.0 + angle / 6.2831853;
  }
  phase = phase + clamp(luma, 0.0, 1.0) * 0.35;
  let distance = abs(fract(phase + 0.5) - 0.5) * spacing;
  let edge = max(fwidth(phase) * spacing * 0.5, 0.35);
  let stroke = 1.0 - smoothstep(globals.params[2].x * 0.5 - edge, globals.params[2].x * 0.5 + edge, distance);
  let darkness = 1.0 - clamp(luma, 0.0, 1.0);
  let ink = globals.params[6].rgb;
  let light = direction * globals.params[5].x;
  let relief = max(1.0 + dot(gradient, light), 0.0);
  let processed = vec4f(mix(sampled.rgb * relief, ink * sampled.a * relief, stroke * darkness * globals.params[6].a), sampled.a);
  return mix(original, processed, amount);
}`;

export const ENGRAVED_SOURCE_EFFECT: EffectDefinition = {
  id: "an-native-owned-cg-engraved-source",
  name: "Engraved Source",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    pattern: {
      type: "enum",
      label: "Engraving pattern",
      default: "Hatch",
      options: ["Hatch", "Spiral"],
    },
    lineSpacing: {
      type: "float",
      label: "Line spacing",
      default: 6,
      min: 2,
      max: 24,
      step: 0.5,
    },
    lineWidth: {
      type: "float",
      label: "Line width",
      default: 1.4,
      min: 0.3,
      max: 6,
      step: 0.1,
    },
    direction: {
      type: "float",
      label: "Line direction",
      default: 0.55,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    displacement: {
      type: "float",
      label: "Relief displacement",
      default: 2,
      min: 0,
      max: 12,
      step: 0.1,
    },
    relief: {
      type: "float",
      label: "Engraving relief",
      default: 0.7,
      min: 0,
      max: 3,
      step: 0.05,
    },
    inkColor: {
      type: "color",
      label: "Engraving ink",
      default: color([0.08, 0.11, 0.16]),
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
      id: "engrave-displaced-source",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Source-luminance hatch or spiral linework is etched into actual source RGBA, with source-gradient UV relief and premultiplied alpha preserved.",
  },
};

export const ENGRAVED_SOURCE_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-cg-fine-hatching",
    name: "Fine Hatching",
    definitionId: ENGRAVED_SOURCE_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      pattern: "Hatch",
      lineSpacing: 4,
      lineWidth: 0.9,
      direction: 0.65,
      displacement: 1.4,
      relief: 0.55,
      inkColor: color([0.07, 0.1, 0.15]),
      amount: 0.95,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-cg-coiled-etch",
    name: "Coiled Etch",
    definitionId: ENGRAVED_SOURCE_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      pattern: "Spiral",
      lineSpacing: 9,
      lineWidth: 2,
      direction: 1.1,
      displacement: 4,
      relief: 1.5,
      inkColor: color([0.26, 0.09, 0.1]),
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
