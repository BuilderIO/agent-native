import {
  NATIVE_RENDER_GLOBALS,
  nativeRenderExtraTextureBindings,
} from "./native-effect-wgsl";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectResourceSpec,
} from "./native-effects";

const MAX_RADIUS = 24;
const KERNEL_TAPS = 6;

const radius = (label: string, value: number): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max: MAX_RADIUS,
  step: 0.1,
  unit: "px",
});
const contrast = (label: string, value: number): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max: 3,
  step: 0.01,
});

const source: EffectResourceSpec = {
  name: "source",
  kind: "texture-2d",
  usage: ["sampled"],
  external: true,
  size: "viewport",
};
const texture = (name: string): EffectResourceSpec => ({
  name,
  kind: "texture-2d",
  format: "rgba16float",
  usage: ["render", "sampled"],
  size: "viewport",
});

function blur(axis: readonly [number, number], radiusIndex: number): string {
  return `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let support = globals.params[${radiusIndex}].x * globals.clock.z;
  let direction = vec2f(${axis[0]}.0, ${axis[1]}.0) * globals.viewport.zw;
  var energy = 0.0;
  var accumulation = vec4f(0.0);
  for (var offset = -${KERNEL_TAPS}; offset <= ${KERNEL_TAPS}; offset += 1) {
    let position = f32(offset) / ${KERNEL_TAPS}.0;
    let weight = exp(-4.5 * position * position);
    let uv = clamp(input.uv + direction * support * position, vec2f(0.0), vec2f(1.0));
    accumulation += textureSampleLevel(sourceTexture, effectSampler, uv, 0.0) * weight;
    energy += weight;
  }
  return accumulation / energy;
}
`;
}

const composite = `${NATIVE_RENDER_GLOBALS}
${nativeRenderExtraTextureBindings(3)}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  if (globals.params[4].x <= 0.0 || original.a <= 0.00001) { return original; }
  let fineBlur = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  let coarseBlur = textureSampleLevel(extraTexture0, effectSampler, input.uv, 0.0);
  let originalAlpha = original.a;
  let originalColor = select(vec3f(0.0), original.rgb / max(originalAlpha, 0.00001), originalAlpha > 0.00001);
  let fineColor = select(vec3f(0.0), fineBlur.rgb / max(fineBlur.a, 0.00001), fineBlur.a > 0.00001);
  let coarseColor = select(vec3f(0.0), coarseBlur.rgb / max(coarseBlur.a, 0.00001), coarseBlur.a > 0.00001);
  let fineDetail = originalColor - fineColor;
  let middleDetail = fineColor - coarseColor;
  let separated = coarseColor
    + middleDetail * globals.params[3].x
    + fineDetail * globals.params[2].x;
  let result = mix(originalColor, separated, globals.params[4].x);
  return vec4f(result * originalAlpha, originalAlpha);
}
`;

const provenance: EffectDefinition["provenance"] = {
  origin: "design-original",
};

export const FREQUENCY_SEPARATION_EFFECT: EffectDefinition = {
  id: "an-native-frequency-separation",
  name: "Frequency Separation",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    fineRadius: radius("Fine Radius", 2.5),
    coarseRadius: radius("Coarse Radius", 12),
    fineContrast: contrast("Fine Contrast", 1),
    middleContrast: contrast("Middle Contrast", 1),
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
    source,
    texture("fineHorizontal"),
    texture("fineBlur"),
    texture("coarseHorizontal"),
    texture("coarseBlur"),
    texture("color"),
  ],
  output: "color",
  provenance,
  passes: [
    {
      id: "fine-horizontal",
      kind: "render",
      reads: ["source"],
      output: "fineHorizontal",
      wgsl: blur([1, 0], 0),
    },
    {
      id: "fine-vertical",
      kind: "render",
      reads: ["fineHorizontal"],
      output: "fineBlur",
      wgsl: blur([0, 1], 0),
    },
    {
      id: "coarse-horizontal",
      kind: "render",
      reads: ["source"],
      output: "coarseHorizontal",
      wgsl: blur([1, 0], 1),
    },
    {
      id: "coarse-vertical",
      kind: "render",
      reads: ["coarseHorizontal"],
      output: "coarseBlur",
      wgsl: blur([0, 1], 1),
    },
    {
      id: "composite",
      kind: "render",
      reads: ["source", "fineBlur", "coarseBlur"],
      output: "color",
      wgsl: composite,
    },
  ],
};

export const FREQUENCY_SEPARATION_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-frequency-separation-natural",
    name: "Natural Retouch",
    definitionId: FREQUENCY_SEPARATION_EFFECT.id,
    definitionVersion: FREQUENCY_SEPARATION_EFFECT.version,
    placement: "layer",
    params: {
      fineRadius: 2.5,
      coarseRadius: 12,
      fineContrast: 0.9,
      middleContrast: 0.85,
      amount: 0.8,
    },
    clip: "bounds",
    provenance,
  },
  {
    id: "an-preset-frequency-separation-detail",
    name: "Fine Detail Lift",
    definitionId: FREQUENCY_SEPARATION_EFFECT.id,
    definitionVersion: FREQUENCY_SEPARATION_EFFECT.version,
    placement: "layer",
    params: {
      fineRadius: 1.5,
      coarseRadius: 8,
      fineContrast: 1.4,
      middleContrast: 1.1,
      amount: 0.7,
    },
    clip: "bounds",
    provenance,
  },
];
