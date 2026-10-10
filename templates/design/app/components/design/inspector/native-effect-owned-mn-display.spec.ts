import {
  OWNED_NEXT_SIX_M_DEFINITIONS,
  OWNED_NEXT_SIX_M_PRESETS,
} from "@shared/native-effect-owned-next-six-m-v2";
import {
  OWNED_NEXT_SIX_N_DEFINITIONS,
  OWNED_NEXT_SIX_N_PRESETS,
} from "@shared/native-effect-owned-next-six-n-v2";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

describe("Design-owned M/N catalog labels", () => {
  it("resolves every picker name, control, enum option, and recipe", () => {
    for (const definition of [
      ...OWNED_NEXT_SIX_M_DEFINITIONS,
      ...OWNED_NEXT_SIX_N_DEFINITIONS,
    ]) {
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
    for (const recipe of [
      ...OWNED_NEXT_SIX_M_PRESETS,
      ...OWNED_NEXT_SIX_N_PRESETS,
    ])
      expect(nativeCatalogPresetKey(recipe), recipe.id).not.toBeNull();
  });
});
