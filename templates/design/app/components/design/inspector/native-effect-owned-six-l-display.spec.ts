import {
  OWNED_NEXT_SIX_L_DEFINITIONS,
  OWNED_NEXT_SIX_L_PRESETS,
} from "@shared/native-effect-owned-next-six-l";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("Design-owned L catalog labels", () => {
  it("resolves every picker name, property, enum option, and recipe", () => {
    for (const definition of OWNED_NEXT_SIX_L_DEFINITIONS) {
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
    for (const preset of OWNED_NEXT_SIX_L_PRESETS)
      expect(nativeCatalogPresetKey(preset), preset.id).not.toBeNull();
  });
});
