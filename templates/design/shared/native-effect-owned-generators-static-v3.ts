import {
  DESIGN_OWNED_GENERATORS,
  DESIGN_OWNED_GENERATOR_PRESETS,
} from "./native-effect-owned-generators";
import type { EffectDefinition, EffectPreset } from "./native-effects";

export const STATIC_V3_IDS = [
  "an-native-owned-leaf-venation",
  "an-native-owned-coral-polyps",
  "an-native-owned-knit-loops",
  "an-native-owned-quilted-diamonds",
  "an-native-owned-lace-rosettes",
  "an-native-owned-sashiko-stitches",
  "an-native-owned-prism-facets",
  "an-native-owned-lenticular-ribs",
  "an-native-owned-anamorphic-streaks",
  "an-native-owned-horizon-haze",
  "an-native-owned-wire-dome",
  "an-native-owned-folded-paper",
  "an-native-owned-crystal-lattice",
] as const;
const idSet = new Set<string>(STATIC_V3_IDS);
const STATIC_V3_DEFINITION_DISPLAY_NAMES = new Map([
  ["an-native-owned-folded-paper", "Folded Sheets"],
]);
const STATIC_V3_PRESET_DISPLAY_NAMES = new Map([
  ["an-preset-owned-folded-paper-signature", "Folded Sheets Signature"],
  ["an-preset-owned-folded-paper-alternate", "Folded Sheets Alternate"],
]);

function exactlyOnce(source: string, oldText: string, newText: string): string {
  if (source.split(oldText).length !== 2)
    throw new Error(`Static v3 source expected exactly one ${oldText}`);
  return source.replace(oldText, newText);
}

function corrected(definition: EffectDefinition): EffectDefinition {
  if (
    definition.version !== 2 ||
    definition.passes.length !== 1 ||
    definition.passes[0]?.kind !== "render" ||
    definition.properties.motion?.type !== "float"
  )
    throw new Error(`Unexpected historical generator shape: ${definition.id}`);
  let wgsl = definition.passes[0].wgsl;
  wgsl = exactlyOnce(wgsl, "  let motion = globals.params[1].x;\n", "");
  wgsl = exactlyOnce(wgsl, "  let t = globals.clock.x * motion;\n", "");
  wgsl = exactlyOnce(wgsl, "globals.params[5].x", "globals.params[4].x");
  wgsl = exactlyOnce(
    wgsl,
    "globals.params[4].x + 0.5",
    "globals.params[3].x + 0.5",
  );
  wgsl = exactlyOnce(
    wgsl,
    "globals.params[2].a, globals.params[3].a",
    "globals.params[1].a, globals.params[2].a",
  );
  wgsl = exactlyOnce(
    wgsl,
    "globals.params[2].rgb, globals.params[3].rgb",
    "globals.params[1].rgb, globals.params[2].rgb",
  );
  if (/\bt\b/.test(wgsl))
    throw new Error(`Static generator still reads time: ${definition.id}`);
  const properties = Object.fromEntries(
    Object.entries(definition.properties).filter(([name]) => name !== "motion"),
  ) as EffectDefinition["properties"];
  return {
    ...definition,
    name:
      STATIC_V3_DEFINITION_DISPLAY_NAMES.get(definition.id) ?? definition.name,
    version: 3,
    properties,
    passes: [{ ...definition.passes[0], wgsl }],
  };
}

export const DESIGN_OWNED_STATIC_V3_DEFINITIONS: readonly EffectDefinition[] =
  DESIGN_OWNED_GENERATORS.filter((definition) => idSet.has(definition.id)).map(
    corrected,
  );
if (DESIGN_OWNED_STATIC_V3_DEFINITIONS.length !== STATIC_V3_IDS.length)
  throw new Error("Static v3 generator inventory changed");

export const DESIGN_OWNED_STATIC_V3_PRESETS: readonly EffectPreset[] =
  DESIGN_OWNED_GENERATOR_PRESETS.filter((preset) =>
    idSet.has(preset.definitionId),
  ).map((preset) => ({
    ...preset,
    name: STATIC_V3_PRESET_DISPLAY_NAMES.get(preset.id) ?? preset.name,
    definitionVersion: 3,
    params: Object.fromEntries(
      Object.entries(preset.params).filter(([name]) => name !== "motion"),
    ),
  }));
