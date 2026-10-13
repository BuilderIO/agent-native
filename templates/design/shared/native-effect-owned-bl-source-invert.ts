import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const wgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[0].x;
  if (amount <= 0.0 || source.a <= 0.0) { return source; }
  let straight = source.rgb / source.a;
  let negative = vec3f(globals.params[1].x) - straight;
  return vec4f(mix(straight, negative, amount) * source.a, source.a);
}`;

export const SOURCE_INVERT_EFFECT: EffectDefinition = {
  id: "an-native-owned-bl-source-invert",
  name: "Source Invert",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    amount: {
      type: "float",
      label: "Amount",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    whitePoint: {
      type: "float",
      label: "Inversion white point",
      default: 1,
      min: 0.1,
      max: 4,
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
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "invert-source",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Inverts actual straight source RGB around an adjustable white point and restores its original premultiplied alpha. HDR channels are not clamped; zero amount returns the source exactly.",
  },
};

export const SOURCE_INVERT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bl-full-negative",
    name: "Full Negative",
    definitionId: SOURCE_INVERT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { amount: 1, whitePoint: 1 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bl-soft-negative",
    name: "Soft Negative",
    definitionId: SOURCE_INVERT_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: { amount: 0.58, whitePoint: 1.16 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
