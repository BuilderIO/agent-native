import {
  OWNED_NEXT_SIX_F_DEFINITIONS,
  OWNED_NEXT_SIX_F_PRESETS,
} from "@shared/native-effect-owned-next-six-f";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("Design-owned F catalog labels", () => {
  it("resolves every exact definition, property, and recipe in the normal picker", () => {
    for (const definition of OWNED_NEXT_SIX_F_DEFINITIONS) {
      expect(
        nativeCatalogDefinitionKey(definition),
        definition.id,
      ).not.toBeNull();
      for (const property of Object.values(definition.properties)) {
        expect(
          nativeCatalogPropertyKey(definition, property.label),
          `${definition.id}: ${property.label}`,
        ).not.toBeNull();
      }
    }
    for (const preset of OWNED_NEXT_SIX_F_PRESETS) {
      expect(nativeCatalogPresetKey(preset), preset.id).not.toBeNull();
    }
  });
});
