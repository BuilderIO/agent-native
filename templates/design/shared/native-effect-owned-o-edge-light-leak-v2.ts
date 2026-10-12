import {
  OWNED_O_EDGE_GLASS_DEFINITIONS,
  OWNED_O_EDGE_GLASS_PRESETS,
} from "./native-effect-owned-o-edge-glass";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const edgeId = "an-native-owned-o-edge-light-leak";
const edgeLightLeakV1 = OWNED_O_EDGE_GLASS_DEFINITIONS.find(
  (definition) => definition.id === edgeId && definition.version === 1,
);
if (!edgeLightLeakV1)
  throw new Error("The frozen Edge Light Leak v1 definition is unavailable.");

function withoutUnusedEdgePolicy(wgsl: string): string {
  const withoutSamplerPolicy = wgsl.replace(
    /\nfn sampleSource\(uv: vec2f\) -> vec4f \{[\s\S]*?\n\}\n/,
    "\n",
  );
  if (withoutSamplerPolicy === wgsl)
    throw new Error(
      "The frozen Edge Light Leak sampler policy is unavailable.",
    );
  const withDirectSample = withoutSamplerPolicy.replace(
    "let src=sampleSource(input.uv);",
    "let src=textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);",
  );
  if (withDirectSample === withoutSamplerPolicy)
    throw new Error("The frozen Edge Light Leak source sample is unavailable.");
  return withDirectSample.replace(
    /globals\.params\[(\d+)\]/g,
    (_match, rawIndex: string) => {
      const index = Number(rawIndex);
      if (index === 0)
        throw new Error("The obsolete Edge Light Leak edge parameter remains.");
      return `globals.params[${index - 1}]`;
    },
  );
}

const liveProperties = Object.fromEntries(
  Object.entries(edgeLightLeakV1.properties).filter(
    ([name]) => name !== "edge",
  ),
);

export const OWNED_O_EDGE_LIGHT_LEAK_V2: EffectDefinition = {
  ...edgeLightLeakV1,
  version: 2,
  properties: liveProperties,
  passes: edgeLightLeakV1.passes.map((pass) => ({
    ...pass,
    wgsl: withoutUnusedEdgePolicy(pass.wgsl),
  })),
};

const edgeLightLeakV1Presets = OWNED_O_EDGE_GLASS_PRESETS.filter(
  (preset) => preset.definitionId === edgeId,
);
export const OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS: readonly EffectPreset[] =
  edgeLightLeakV1Presets.map((preset, index) => ({
    ...structuredClone(preset),
    id: `an-preset-owned-o-edge-light-leak-v2-${index + 1}`,
    definitionVersion: OWNED_O_EDGE_LIGHT_LEAK_V2.version,
  }));

export const OWNED_O_EDGE_LIGHT_LEAK_V2_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  OWNED_O_EDGE_LIGHT_LEAK_V2_PRESETS.map((preset, index) => [
    preset.id,
    edgeLightLeakV1Presets[index]!.id,
  ]),
);
