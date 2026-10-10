import { NATIVE_EFFECT_DEFINITIONS_V1 } from "@shared/native-effect-definitions-v1";
import {
  GRAIN_GRADIENT_EFFECT,
  NATIVE_EFFECT_DEFINITIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_PRESETS,
  NATIVE_V3_PRESET_LABEL_SOURCE_IDS,
} from "@shared/native-effect-presets";
import { describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogHistoricalBuiltinVersion,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("native catalog display identity", () => {
  it("provides display keys for every registered definition, control, option, and preset", () => {
    for (const definition of NATIVE_EFFECT_DEFINITION_CATALOG) {
      expect(
        nativeCatalogDefinitionKey(definition),
        definition.id,
      ).not.toBeNull();
      for (const property of Object.values(definition.properties)) {
        expect(
          nativeCatalogPropertyKey(definition, property.label),
          `${definition.id}: ${property.label}`,
        ).not.toBeNull();
        if (property.type === "enum")
          for (const option of property.options)
            expect(
              nativeCatalogOptionKey(definition, option),
              `${definition.id}: ${option}`,
            ).not.toBeNull();
      }
    }
    for (const preset of NATIVE_EFFECT_PRESETS)
      expect(nativeCatalogPresetKey(preset), preset.id).not.toBeNull();
  });

  it("localizes a persisted canonical definition without changing its metadata", () => {
    const persisted = structuredClone(GRAIN_GRADIENT_EFFECT);
    const before = JSON.stringify(persisted);
    expect(nativeCatalogDefinitionKey(persisted)).toBe(
      "editPanel.shaders.nativeCatalog.definitions.grain-gradient",
    );
    expect(nativeCatalogPropertyKey(persisted, "Orange")).toBe(
      "editPanel.shaders.nativeCatalog.properties.orange",
    );
    expect(
      nativeCatalogPresetKey(structuredClone(NATIVE_EFFECT_PRESETS[0])),
    ).toBe(
      "editPanel.shaders.nativeCatalog.presets.an-preset-orange-cream-grain",
    );
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it("keeps authored names for a changed definition or preset with a known ID", () => {
    const altered = structuredClone(GRAIN_GRADIENT_EFFECT);
    altered.name = "My Gradient";
    expect(nativeCatalogDefinitionKey(altered)).toBeNull();
    expect(nativeCatalogPropertyKey(altered, "Orange")).toBeNull();
    const preset = structuredClone(NATIVE_EFFECT_PRESETS[0]);
    preset.name = "My Orange";
    expect(nativeCatalogPresetKey(preset)).toBeNull();
  });

  it("reuses each reviewed localized label only for an exact v3 preset", () => {
    for (const [id, sourceId] of Object.entries(
      NATIVE_V3_PRESET_LABEL_SOURCE_IDS,
    )) {
      const preset = NATIVE_EFFECT_PRESETS.find((item) => item.id === id);
      expect(preset).toBeDefined();
      expect(nativeCatalogPresetKey(structuredClone(preset!))).toBe(
        `editPanel.shaders.nativeCatalog.presets.${sourceId}`,
      );
      expect(
        nativeCatalogPresetKey({ ...preset!, name: "Authored copy" }),
      ).toBeNull();
    }
  });

  it("uses catalog keys only for exact registered definitions and presets", () => {
    const catalog = enUS.editPanel.shaders.nativeCatalog;
    const exact = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) => item.id === GRAIN_GRADIENT_EFFECT.id && item.version === 1,
    );
    expect(exact).toBeDefined();
    expect(nativeCatalogDefinitionKey(structuredClone(exact!))).toBe(
      "editPanel.shaders.nativeCatalog.definitions.grain-gradient",
    );
    expect(catalog.definitions).toHaveProperty("grain-gradient");
    expect(
      nativeCatalogPresetKey(structuredClone(NATIVE_EFFECT_PRESETS[0])),
    ).toBe(
      "editPanel.shaders.nativeCatalog.presets.an-preset-orange-cream-grain",
    );
  });

  it("identifies older exact core versions without labeling the latest", () => {
    for (const historical of [
      ...NATIVE_EFFECT_DEFINITIONS_V1,
      ...NATIVE_EFFECT_DEFINITIONS,
    ]) {
      expect(
        nativeCatalogHistoricalBuiltinVersion(
          historical.id,
          historical.version,
        ),
      ).toBe(historical.version);
    }
    for (const latest of NATIVE_EFFECT_LATEST_DEFINITIONS)
      expect(
        nativeCatalogHistoricalBuiltinVersion(latest.id, latest.version),
      ).toBeNull();
  });

  it("does not translate a forged Design-owned definition or preset", () => {
    const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) => item.id === "an-native-owned-shadow-lift",
    );
    expect(definition).toBeDefined();
    expect(
      nativeCatalogDefinitionKey({ ...definition!, name: "Authored copy" }),
    ).toBeNull();
    const preset = NATIVE_EFFECT_PRESETS.find(
      (item) => item.definitionId === definition!.id,
    );
    expect(preset).toBeDefined();
    expect(
      nativeCatalogPresetKey({ ...preset!, name: "Authored copy" }),
    ).toBeNull();
  });
});
