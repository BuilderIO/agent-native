import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn hash1(value: f32) -> f32 {
  return fract(sin(value * 127.1 + 311.7) * 43758.5453);
}
fn mirrorCoordinate(value: vec2f) -> vec2f {
  return vec2f(1.0) - abs(fract(value * 0.5) * 2.0 - vec2f(1.0));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[6].x;
  if (amount <= 0.0) { return original; }
  let cssPoint = input.uv * globals.viewport.xy / globals.clock.z;
  let angle = globals.params[0].x;
  let tangent = vec2f(cos(angle), sin(angle));
  let normal = vec2f(-tangent.y, tangent.x);
  let strip = floor(dot(cssPoint, normal) / globals.params[1].x);
  let parity = fract(strip * 0.5);
  let alternating = select(-1.0, 1.0, parity < 0.5);
  let random = hash1(strip + globals.params[4].x) * 2.0 - 1.0;
  let signedShift = mix(alternating, random, globals.params[3].x) * globals.params[2].x;
  let shiftedUv = input.uv - tangent * signedShift * globals.clock.z * globals.viewport.zw;
  let edgeMode = globals.params[5].x;
  var shifted = vec4f(0.0);
  if (edgeMode < 0.5) {
    if (all(shiftedUv >= vec2f(0.0)) && all(shiftedUv <= vec2f(1.0))) {
      shifted = textureSampleLevel(sourceTexture, effectSampler, shiftedUv, 0.0);
    }
  } else if (edgeMode < 1.5) {
    shifted = textureSampleLevel(sourceTexture, effectSampler, clamp(shiftedUv, vec2f(0.0), vec2f(1.0)), 0.0);
  } else if (edgeMode < 2.5) {
    shifted = textureSampleLevel(sourceTexture, effectSampler, fract(shiftedUv), 0.0);
  } else {
    shifted = textureSampleLevel(sourceTexture, effectSampler, mirrorCoordinate(shiftedUv), 0.0);
  }
  return mix(original, shifted, amount);
}`;

export const ANGLED_BAR_SHIFT_EFFECT: EffectDefinition = {
  id: "an-native-owned-ch-angled-bar-shift",
  name: "Angled Bar Shift",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    angle: {
      type: "float",
      label: "Bar angle",
      default: 0.35,
      min: -3.14,
      max: 3.14,
      step: 0.01,
    },
    barWidth: {
      type: "float",
      label: "Bar width",
      default: 16,
      min: 2,
      max: 100,
      step: 1,
    },
    shift: {
      type: "float",
      label: "Shift distance",
      default: 26,
      min: 0,
      max: 160,
      step: 1,
    },
    randomness: {
      type: "float",
      label: "Shift variation",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    seed: {
      type: "float",
      label: "Bar seed",
      default: 7,
      min: 0,
      max: 1000,
      step: 1,
    },
    edgeMode: {
      type: "enum",
      label: "Edge mode",
      default: "Transparent",
      options: ["Transparent", "Clamp", "Wrap", "Mirror"],
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
      id: "shift-angled-source-bars",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Each angled CSS-sized bar receives an independently indexed source-coordinate shift, with transparent, clamp, wrap, and mirrored source-edge sampling.",
  },
};

export const ANGLED_BAR_SHIFT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ch-slipped-ribbons",
    name: "Slipped Ribbons",
    definitionId: ANGLED_BAR_SHIFT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: {
      angle: 0.42,
      barWidth: 12,
      shift: 32,
      randomness: 0.18,
      seed: 7,
      edgeMode: "Transparent",
      amount: 0.9,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ch-mirrored-slats",
    name: "Mirrored Slats",
    definitionId: ANGLED_BAR_SHIFT_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      angle: -1.1,
      barWidth: 28,
      shift: 78,
      randomness: 1,
      seed: 313,
      edgeMode: "Mirror",
      amount: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
