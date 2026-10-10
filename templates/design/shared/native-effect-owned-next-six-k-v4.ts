import {
  OWNED_NEXT_SIX_K_V3_DEFINITIONS,
  OWNED_NEXT_SIX_K_V3_PRESETS,
} from "./native-effect-owned-next-six-k-v3";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const gamutId = "an-native-owned-k-gamut-shoulder";
const oldGamut = OWNED_NEXT_SIX_K_V3_DEFINITIONS.find(
  (definition) => definition.id === gamutId,
);
if (!oldGamut || oldGamut.version !== 1 || oldGamut.passes.length !== 1)
  throw new Error("The frozen Gamut Shoulder predecessor is unavailable.");
const oldWgsl = oldGamut.passes[0]!.wgsl;
const declared = "let target = min(";
const used = "mix(target, min(soft, limit),";
if (
  oldWgsl.split(declared).length !== 2 ||
  oldWgsl.split(used).length !== 2 ||
  [...oldWgsl.matchAll(/\btarget\b/g)].length !== 2
)
  throw new Error(
    "The frozen Gamut Shoulder WGSL no longer has its exact reserved identifier shape.",
  );
const boundedWgsl = oldWgsl
  .replace(declared, "let desiredExpansion = min(")
  .replace(used, "mix(desiredExpansion, min(soft, limit),");
if (/\btarget\b/.test(boundedWgsl))
  throw new Error("The reserved WGSL identifier remains in Gamut Shoulder.");
const boundedGamut: EffectDefinition = {
  ...oldGamut,
  version: 2,
  passes: [{ ...oldGamut.passes[0]!, wgsl: boundedWgsl }],
};
export const OWNED_NEXT_SIX_K_V4_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_K_V3_DEFINITIONS.map((definition) =>
    definition.id === gamutId ? boundedGamut : definition,
  );
export const OWNED_NEXT_SIX_K_V4_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_K_V3_PRESETS.map((preset) =>
    preset.definitionId === gamutId
      ? { ...preset, definitionVersion: 2 }
      : preset,
  );
