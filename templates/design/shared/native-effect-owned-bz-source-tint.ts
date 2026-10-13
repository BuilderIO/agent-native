import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let tint = globals.params[0];
  let amount = globals.params[2].x * tint.a;
  if (amount <= 0.0 || source.a <= 0.0) { return source; }
  let straight = source.rgb / source.a;
  var tinted = straight * tint.rgb;
  if (globals.params[1].x > 0.5) {
    let sourceLuma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
    let tintLuma = dot(tint.rgb, vec3f(0.2126, 0.7152, 0.0722));
    tinted = tint.rgb * (sourceLuma / max(tintLuma, 0.00001));
  }
  return vec4f(mix(straight, tinted, amount) * source.a, source.a);
}`;

export const SOURCE_TINT_EFFECT: EffectDefinition = {
  id: "an-native-owned-bz-source-tint",
  name: "Source Tint",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    tint: { type: "color", label: "Tint color", default: color([0.3, 0.7, 1]) },
    tintMode: {
      type: "enum",
      label: "Tint mode",
      default: "Multiply",
      options: ["Multiply", "Preserve luminosity"],
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
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "tint-source",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Multiplies actual straight source RGB by any selected tint, or maps tint hue to the source luminance. It preserves source alpha, does not clamp HDR RGB, and returns the exact source at zero amount.",
  },
};

export const SOURCE_TINT_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-bz-cobalt-wash",
    name: "Cobalt Wash",
    definitionId: SOURCE_TINT_EFFECT.id,
    definitionVersion: 1,
    placement: "layer",
    params: { tint: color([0.22, 0.48, 1]), tintMode: "Multiply", amount: 0.9 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-bz-rose-luminance",
    name: "Rose Luminance",
    definitionId: SOURCE_TINT_EFFECT.id,
    definitionVersion: 1,
    placement: "backdrop",
    params: {
      tint: color([1, 0.3, 0.46]),
      tintMode: "Preserve luminosity",
      amount: 0.82,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
