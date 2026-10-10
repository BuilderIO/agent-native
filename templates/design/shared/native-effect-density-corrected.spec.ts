import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import {
  createDensityCorrectedFrostEffect,
  createDensityCorrectedHalftoneEffect,
} from "./native-effect-density-corrected";
import {
  FROSTED_REFRACTION_EFFECT,
  HALFTONE_EFFECT,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

describe("versioned density-corrected native processors", () => {
  it.each([
    [HALFTONE_EFFECT, createDensityCorrectedHalftoneEffect],
    [FROSTED_REFRACTION_EFFECT, createDensityCorrectedFrostEffect],
  ])(
    "retains the pinned v2 execution and validates a separate float v3",
    async (v2, create) => {
      const previousHash = await hashEffectDefinition(v2);
      const v3 = create(v2);
      const validated = validateEffectDocument({
        schemaVersion: 2,
        definitions: [v2, v3],
        instances: [],
      });
      expect(validated.errors).toEqual([]);
      expect(planEffectGraph(v3).errors).toEqual([]);
      expect(v3).toMatchObject({ id: v2.id, version: 3 });
      expect(v2.version).toBe(2);
      expect(await hashEffectDefinition(v2)).toBe(previousHash);
      expect(await hashEffectDefinition(v3)).not.toBe(previousHash);
      expect(
        v2.resources?.find((resource) => resource.name === "color")?.format,
      ).toBe("rgba8unorm");
      expect(
        v3.resources?.find((resource) => resource.name === "color")?.format,
      ).toBe("rgba16float");
      expect([...packNativeProperties(v3)]).toEqual([
        ...packNativeProperties(v2),
      ]);
    },
  );
});
