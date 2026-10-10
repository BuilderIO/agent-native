import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import {
  OWNED_PROCESSOR_DEFINITIONS,
  OWNED_PROCESSOR_PRESETS,
} from "./native-effect-owned-processors";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

describe("Design-authored processor candidates", () => {
  it("provides twenty distinct bounded layer and backdrop algorithms", async () => {
    expect(OWNED_PROCESSOR_DEFINITIONS).toHaveLength(20);
    expect(
      new Set(OWNED_PROCESSOR_DEFINITIONS.map((effect) => effect.id)).size,
    ).toBe(20);
    expect(
      new Set(OWNED_PROCESSOR_DEFINITIONS.map((effect) => effect.name)).size,
    ).toBe(20);
    expect(
      new Set(
        OWNED_PROCESSOR_DEFINITIONS.map((effect) => effect.passes[0]?.wgsl),
      ).size,
    ).toBe(20);
    const hashes = await Promise.all(
      OWNED_PROCESSOR_DEFINITIONS.map(hashEffectDefinition),
    );
    expect(new Set(hashes).size).toBe(20);
    for (const effect of OWNED_PROCESSOR_DEFINITIONS) {
      expect(effect).toMatchObject({
        kind: "processor",
        version: 1,
        placements: ["layer", "backdrop"],
      });
      expect(effect.provenance).toMatchObject({ origin: "design-original" });
      expect(planEffectGraph(effect).errors).toEqual([]);
      expect(
        Array.from(packNativeProperties(effect)).every(Number.isFinite),
      ).toBe(true);
    }
  });

  it("keeps two original looks per effect within the canonical property bounds", () => {
    expect(OWNED_PROCESSOR_PRESETS).toHaveLength(40);
    expect(
      new Set(OWNED_PROCESSOR_PRESETS.map((preset) => preset.id)).size,
    ).toBe(40);
    const definitions = new Map(
      OWNED_PROCESSOR_DEFINITIONS.map((effect) => [effect.id, effect]),
    );
    for (const preset of OWNED_PROCESSOR_PRESETS) {
      const definition = definitions.get(preset.definitionId);
      expect(definition).toBeDefined();
      expect(preset).toMatchObject({
        definitionVersion: 1,
        placement: "layer",
        clip: "bounds",
        provenance: { origin: "design-original" },
      });
      expect(
        Array.from(packNativeProperties(definition!, preset.params)).every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: OWNED_PROCESSOR_DEFINITIONS,
        instances: [],
        presets: OWNED_PROCESSOR_PRESETS,
      }).errors,
    ).toEqual([]);
  });

  it("refuses nonfinite and out-of-range authored parameters", () => {
    for (const effect of OWNED_PROCESSOR_DEFINITIONS) {
      const first = Object.entries(effect.properties).find(
        ([, property]) => property.type === "float",
      );
      expect(first).toBeDefined();
      const [name, property] = first!;
      if (property.type !== "float") throw new Error("Expected float control");
      expect(() =>
        packNativeProperties(effect, { [name]: Number.NaN }),
      ).toThrow();
      expect(() =>
        packNativeProperties(effect, { [name]: (property.max ?? 0) + 1 }),
      ).toThrow();
    }
  });
});
