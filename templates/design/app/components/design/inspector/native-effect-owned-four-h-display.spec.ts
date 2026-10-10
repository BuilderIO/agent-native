import {
  OWNED_NEXT_FOUR_H_DEFINITIONS,
  OWNED_NEXT_FOUR_H_PRESETS,
} from "@shared/native-effect-owned-next-four-h";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("Design-owned H catalog labels", () => {
  it("resolves every registered definition, control, and recipe", () => {
    for (const definition of OWNED_NEXT_FOUR_H_DEFINITIONS) {
      expect(
        nativeCatalogDefinitionKey(definition),
        definition.id,
      ).not.toBeNull();
      for (const property of Object.values(definition.properties))
        expect(
          nativeCatalogPropertyKey(definition, property.label),
          `${definition.id}: ${property.label}`,
        ).not.toBeNull();
    }
    for (const preset of OWNED_NEXT_FOUR_H_PRESETS)
      expect(nativeCatalogPresetKey(preset), preset.id).not.toBeNull();
  });
});
