import { describe, expect, it } from "vitest";

import {
  DESIGN_OWNED_GENERATORS,
  DESIGN_OWNED_GENERATOR_PRESETS,
} from "./native-effect-owned-generators";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { validateEffectDocument, type EffectInstance } from "./native-effects";

const instance = (
  definitionId: string,
  definitionVersion: number,
  params: EffectInstance["params"],
): EffectInstance => ({
  id: `instance-${definitionId}`,
  nodeId: `node-${definitionId}`,
  definitionId,
  definitionVersion,
  placement: "fill",
  params,
  enabled: true,
  opacity: 1,
  seed: 73,
  clip: "bounds",
  blend: "normal",
  timing: { speed: 1, paused: true, time: 0 },
});

describe("Design-owned generator candidates", () => {
  it("has 25 unique original algorithms across five visual families", () => {
    expect(DESIGN_OWNED_GENERATORS).toHaveLength(25);
    const ids = DESIGN_OWNED_GENERATORS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(25);
    for (const definition of DESIGN_OWNED_GENERATORS) {
      expect(
        NATIVE_EFFECT_DEFINITION_CATALOG.filter(
          (registered) =>
            registered.id === definition.id &&
            registered.version === definition.version,
        ),
      ).toEqual([definition]);
    }
    const bodies = DESIGN_OWNED_GENERATORS.map(
      (definition) => definition.passes[0]!.wgsl,
    );
    expect(new Set(bodies).size).toBe(25);
    expect(ids.every((id) => id.startsWith("an-native-owned-"))).toBe(true);
    expect(
      DESIGN_OWNED_GENERATORS.every(
        (definition) =>
          definition.provenance.origin === "design-original" &&
          definition.provenance.upstream === undefined,
      ),
    ).toBe(true);
    expect(
      bodies.every(
        (body) =>
          body.includes("let field =") &&
          body.includes("return vec4f(rgb * alpha, alpha)"),
      ),
    ).toBe(true);
  });

  it("validates every standalone definition and each pair of authored presets", () => {
    expect(DESIGN_OWNED_GENERATOR_PRESETS).toHaveLength(50);
    expect(
      new Set(DESIGN_OWNED_GENERATOR_PRESETS.map((preset) => preset.id)).size,
    ).toBe(50);
    for (const definition of DESIGN_OWNED_GENERATORS) {
      const presets = DESIGN_OWNED_GENERATOR_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets).toHaveLength(2);
      expect(definition.kind).toBe("generator");
      expect(definition.placements).toEqual(["fill"]);
      expect(definition.passes).toHaveLength(1);
      expect(definition.passes[0]?.reads).toEqual([]);
      expect(definition.resources?.[0]?.format).toBe("rgba16float");
      for (const preset of presets) {
        expect(preset.provenance.origin).toBe("design-original");
        expect(preset.definitionVersion).toBe(definition.version);
        const result = validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [
            instance(definition.id, definition.version, preset.params),
          ],
        });
        expect(result.errors, `${definition.id}/${preset.id}`).toEqual([]);
      }
    }
  });

  it("has unique exact execution hashes and no image, original-pass, or source dependency", async () => {
    const hashes = await Promise.all(
      DESIGN_OWNED_GENERATORS.map((definition) =>
        hashEffectDefinition(definition),
      ),
    );
    expect(new Set(hashes).size).toBe(25);
    for (const definition of DESIGN_OWNED_GENERATORS) {
      expect(definition.inputs).toBeUndefined();
      expect(definition.optionalImage).toBeUndefined();
      expect(definition.sourceSizing).toBeUndefined();
      expect(definition.passes[0]?.original).toBeUndefined();
      expect(
        definition.resources?.every((resource) => resource.external !== true),
      ).toBe(true);
      expect(definition.properties.feature.type).toBe("float");
      expect(definition.properties.feature.label).not.toBe("Feature");
    }
  });
});
