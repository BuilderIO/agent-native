import {
  OWNED_NEXT_SIX_I_DEFINITIONS,
  OWNED_NEXT_SIX_I_PRESETS,
} from "@shared/native-effect-owned-next-six-i";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("Design-owned I catalog labels", () => {
  it("resolves every registered name, control, and original recipe", () => {
    for (const definition of OWNED_NEXT_SIX_I_DEFINITIONS) {
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
    for (const preset of OWNED_NEXT_SIX_I_PRESETS)
      expect(nativeCatalogPresetKey(preset), preset.id).not.toBeNull();
  });
});
