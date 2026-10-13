import { catalogFloat, catalogShader } from "./native-effect-catalog-kit";
import { OWNED_NEXT_SIX_J_DEFINITIONS } from "./native-effect-owned-next-six-j";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const prior = OWNED_NEXT_SIX_J_DEFINITIONS.find(
  (definition) => definition.id === "an-native-owned-j-waterline-mirror",
);
if (!prior) throw new Error("Waterline Mirror v1 is missing");

const base = catalogShader({
  id: "owned-j-waterline-mirror",
  name: "Waterline Mirror",
  version: 2,
  kind: "processor",
  backdrop: true,
  properties: {
    ...prior.properties,
    depthBlur: {
      type: "float",
      label: "Reflection blur",
      default: 0,
      min: 0,
      max: 24,
      step: 0.1,
      unit: "px",
    },
    alphaFade: catalogFloat("Alpha fade", 0, 0, 1),
  },
  helpers: () => `
fn depthBlurredSource(uv: vec2f, radiusCss: f32) -> vec4f {
  if (radiusCss <= 0.0) { return sampleSource(uv); }
  let offset = radiusCss * globals.clock.z * globals.viewport.zw;
  let left = vec2f(-offset.x, 0.0);
  let right = vec2f(offset.x, 0.0);
  let up = vec2f(0.0, -offset.y);
  let down = vec2f(0.0, offset.y);
  let center = sampleSource(uv) * 4.0;
  let axial = sampleSource(uv + left) + sampleSource(uv + right) +
    sampleSource(uv + up) + sampleSource(uv + down);
  let diagonal = sampleSource(uv + left + up) + sampleSource(uv + left + down) +
    sampleSource(uv + right + up) + sampleSource(uv + right + down);
  return (center + axial * 2.0 + diagonal) * 0.0625;
}
`,
  fragment: (p) => `
  let original = sampleSource(input.uv);
  let depth = input.uv.y - ${p("horizon")}.x;
  if (depth <= 0.0 || ${p("amount")}.x <= 0.0) { return original; }
  let relativeDepth = clamp(depth / max(1.0 - ${p("horizon")}.x, 0.0001), 0.0, 1.0);
  let wavelength = max(${p("wavelength")}.x * globals.clock.z, 1.0);
  let phase = input.uv.x * globals.viewport.x / wavelength * TAU + depth * 14.0 + ${p("phase")}.x;
  let wave = sin(phase) * ${p("amplitude")}.x * globals.clock.z * globals.viewport.z;
  let mapped = vec2f(input.uv.x + wave * clamp(depth * 3.0, 0.0, 1.0),
    2.0 * ${p("horizon")}.x - input.uv.y);
  let reflected = depthBlurredSource(mapped, ${p("depthBlur")}.x * relativeDepth);
  let attenuation = 1.0 - ${p("attenuation")}.x * relativeDepth;
  let opacity = 1.0 - ${p("alphaFade")}.x * relativeDepth;
  let reflection = vec4f(reflected.rgb * attenuation * opacity, reflected.a * opacity);
  return mix(original, reflection, ${p("amount")}.x);`,
});

export const WATERLINE_MIRROR_V2_EFFECT: EffectDefinition = {
  ...base,
  resources: base.resources?.map((resource) =>
    resource.name === "color"
      ? { ...resource, format: "rgba16float" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "Source reflection with a fixed nine-tap premultiplied depth blur and an independent alpha fade.",
  },
};

export const WATERLINE_MIRROR_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-j-waterline-mirror-v2-hazy-lake",
    name: "Hazy Lake",
    definitionId: WATERLINE_MIRROR_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    clip: "bounds",
    params: {
      horizon: 0.56,
      wavelength: 86,
      amplitude: 3,
      attenuation: 0.24,
      depthBlur: 9,
      alphaFade: 0.35,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-j-waterline-mirror-v2-dissolving-wake",
    name: "Dissolving Wake",
    definitionId: WATERLINE_MIRROR_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    clip: "bounds",
    params: {
      horizon: 0.43,
      wavelength: 28,
      amplitude: 13,
      attenuation: 0.55,
      phase: 1.15,
      depthBlur: 16,
      alphaFade: 0.82,
    },
    provenance: { origin: "design-original" },
  },
];
