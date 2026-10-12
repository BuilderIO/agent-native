import {
  OWNED_O_EDGE_GLASS_DEFINITIONS,
  OWNED_O_EDGE_GLASS_PRESETS,
} from "@shared/native-effect-owned-o-edge-glass";
import { describe, expect, it } from "vitest";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";
describe("owned O edge and glass catalog labels", () => {
  it("resolves both definitions, properties, options and presets", () => {
    for (const d of OWNED_O_EDGE_GLASS_DEFINITIONS) {
      expect(nativeCatalogDefinitionKey(d), d.id).not.toBeNull();
      for (const property of Object.values(d.properties)) {
        expect(
          nativeCatalogPropertyKey(d, property.label),
          `${d.id}: ${property.label}`,
        ).not.toBeNull();
        if (property.type === "enum")
          for (const option of property.options)
            expect(
              nativeCatalogOptionKey(d, option),
              `${d.id}: ${option}`,
            ).not.toBeNull();
      }
    }
    for (const p of OWNED_O_EDGE_GLASS_PRESETS)
      expect(nativeCatalogPresetKey(p), p.id).not.toBeNull();
  });
});
