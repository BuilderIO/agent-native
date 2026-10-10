import {
  OWNED_NEXT_SIX_J_DEFINITIONS,
  OWNED_NEXT_SIX_J_PRESETS,
} from "@shared/native-effect-owned-next-six-j";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("Design-owned J catalog labels", () => {
  it("resolves every normal picker name, property, enum option, and original recipe", () => {
    for (const definition of OWNED_NEXT_SIX_J_DEFINITIONS) {
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
    for (const preset of OWNED_NEXT_SIX_J_PRESETS)
      expect(nativeCatalogPresetKey(preset), preset.id).not.toBeNull();
  });
});
