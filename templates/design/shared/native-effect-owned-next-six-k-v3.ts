import {
  OWNED_NEXT_SIX_K_V2_DEFINITIONS,
  OWNED_NEXT_SIX_K_V2_PRESETS,
} from "./native-effect-owned-next-six-k-v2";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const hilbertId = "an-native-owned-k-hilbert-trace";
const hilbert = OWNED_NEXT_SIX_K_V2_DEFINITIONS.find(
  (definition) => definition.id === hilbertId,
);
if (!hilbert || hilbert.properties.margin?.type !== "float")
  throw new Error("The frozen Hilbert margin definition is unavailable.");

const boundedHilbert: EffectDefinition = {
  ...hilbert,
  version: 2,
  properties: {
    ...hilbert.properties,
    margin: { ...hilbert.properties.margin, max: 0.45 },
  },
};

export const OWNED_NEXT_SIX_K_V3_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_K_V2_DEFINITIONS.map((definition) =>
    definition.id === hilbertId ? boundedHilbert : definition,
  );
export const OWNED_NEXT_SIX_K_V3_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_K_V2_PRESETS.map((preset) =>
    preset.definitionId === hilbertId
      ? { ...preset, definitionVersion: 2 }
      : preset,
  );
