import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
  NATIVE_PRESET_LABEL_SOURCE_IDS,
} from "@shared/native-effect-presets";
import type { EffectDefinition, EffectPreset } from "@shared/native-effects";

import enUS from "@/i18n/en-US";

type Catalog = typeof enUS.editPanel.shaders.nativeCatalog;
export type NativeCatalogDisplayKey =
  | `editPanel.shaders.nativeCatalog.definitions.${keyof Catalog["definitions"]}`
  | `editPanel.shaders.nativeCatalog.properties.${keyof Catalog["properties"]}`
  | `editPanel.shaders.nativeCatalog.options.${keyof Catalog["options"]}`
  | `editPanel.shaders.nativeCatalog.presets.${keyof Catalog["presets"]}`;

const definitions = new Map(
  NATIVE_EFFECT_DEFINITION_CATALOG.map((definition) => [
    `${definition.id}@${definition.version}`,
    definition,
  ]),
);
const presets = new Map(
  NATIVE_EFFECT_PRESETS.map((preset) => [preset.id, preset]),
);
const definitionMatch = new WeakMap<EffectDefinition, boolean>();
const presetMatch = new WeakMap<EffectPreset, boolean>();

function exactRegisteredDefinition(definition: EffectDefinition): boolean {
  const cached = definitionMatch.get(definition);
  if (cached !== undefined) return cached;
  const registered = definitions.get(`${definition.id}@${definition.version}`);
  const matches =
    registered !== undefined &&
    (registered === definition ||
      JSON.stringify(registered) === JSON.stringify(definition));
  definitionMatch.set(definition, matches);
  return matches;
}

function labelKey(label: string): string {
  const words = label.split(/\s+/);
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");
}

export function nativeCatalogDefinitionKey(
  definition: EffectDefinition,
): NativeCatalogDisplayKey | null {
  if (!exactRegisteredDefinition(definition)) return null;
  const slug = definition.id.replace(/^an-native-/, "");
  if (
    !Object.prototype.hasOwnProperty.call(
      enUS.editPanel.shaders.nativeCatalog.definitions,
      slug,
    )
  )
    return null;
  return `editPanel.shaders.nativeCatalog.definitions.${slug}` as NativeCatalogDisplayKey;
}

export function nativeCatalogBuiltinKey(
  id: string,
  version: number,
): NativeCatalogDisplayKey | null {
  const definition = definitions.get(`${id}@${version}`);
  return definition ? nativeCatalogDefinitionKey(definition) : null;
}

export function nativeCatalogHistoricalBuiltinVersion(
  id: string,
  version: number,
): number | null {
  const latest = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
    (definition) => definition.id === id,
  );
  return latest && version < latest.version ? version : null;
}

export function nativeCatalogPropertyKey(
  definition: EffectDefinition,
  label: string,
): NativeCatalogDisplayKey | null {
  if (!exactRegisteredDefinition(definition)) return null;
  if (
    !Object.values(definition.properties).some(
      (property) => property.label === label,
    )
  )
    return null;
  const key = labelKey(label);
  if (
    !Object.prototype.hasOwnProperty.call(
      enUS.editPanel.shaders.nativeCatalog.properties,
      key,
    )
  )
    return null;
  return `editPanel.shaders.nativeCatalog.properties.${key}` as NativeCatalogDisplayKey;
}

export function nativeCatalogOptionKey(
  definition: EffectDefinition,
  option: string,
): NativeCatalogDisplayKey | null {
  if (!exactRegisteredDefinition(definition)) return null;
  if (
    !Object.values(definition.properties).some(
      (property) =>
        property.type === "enum" && property.options.includes(option),
    )
  )
    return null;
  if (
    !Object.prototype.hasOwnProperty.call(
      enUS.editPanel.shaders.nativeCatalog.options,
      option,
    )
  )
    return null;
  return `editPanel.shaders.nativeCatalog.options.${option}` as NativeCatalogDisplayKey;
}

export function nativeCatalogPresetKey(
  preset: EffectPreset,
): NativeCatalogDisplayKey | null {
  const cached = presetMatch.get(preset);
  const registered = presets.get(preset.id);
  const matches =
    cached ??
    (registered !== undefined &&
      (registered === preset ||
        JSON.stringify(registered) === JSON.stringify(preset)));
  presetMatch.set(preset, matches);
  const labelId = NATIVE_PRESET_LABEL_SOURCE_IDS[preset.id] ?? preset.id;
  if (
    !matches ||
    !Object.prototype.hasOwnProperty.call(
      enUS.editPanel.shaders.nativeCatalog.presets,
      labelId,
    )
  )
    return null;
  return `editPanel.shaders.nativeCatalog.presets.${labelId}` as NativeCatalogDisplayKey;
}
