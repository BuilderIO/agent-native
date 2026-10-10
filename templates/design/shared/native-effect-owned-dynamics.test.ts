import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import {
  DESIGN_OWNED_DYNAMICS_DEFINITIONS,
  DESIGN_OWNED_DYNAMICS_PRESETS,
  DESIGN_OWNED_FEEDBACK_KERNELS,
  DESIGN_OWNED_FEEDBACK_RESOLVE_WGSL,
  DESIGN_OWNED_STATEFUL_DEFINITIONS,
  DESIGN_OWNED_STATEFUL_PRESETS,
} from "./native-effect-owned-dynamics";
import { packNativeProperties, validateEffectDocument } from "./native-effects";
import { adaptNativeFeedbackDefinition } from "./native-feedback-plan";

describe("Design-owned dynamics candidates", () => {
  it("declares ten distinct valid algorithms with bounded graphs and original provenance", () => {
    expect(DESIGN_OWNED_DYNAMICS_DEFINITIONS).toHaveLength(10);
    expect(
      DESIGN_OWNED_DYNAMICS_DEFINITIONS.find(
        (item) => item.id === "an-native-firefly-drift",
      )?.version,
    ).toBe(2);
    expect(
      new Set(DESIGN_OWNED_DYNAMICS_DEFINITIONS.map((item) => item.id)).size,
    ).toBe(10);
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [...DESIGN_OWNED_DYNAMICS_DEFINITIONS],
        instances: [],
        presets: [...DESIGN_OWNED_DYNAMICS_PRESETS],
      }).errors,
    ).toEqual([]);
    for (const definition of DESIGN_OWNED_DYNAMICS_DEFINITIONS) {
      expect(definition.provenance.origin).toBe("design-original");
      expect(definition.provenance.upstream).toBeUndefined();
      expect(planEffectGraph(definition).errors).toEqual([]);
      expect(
        Array.from(packNativeProperties(definition)).every(Number.isFinite),
      ).toBe(true);
      expect(
        definition.passes.every((pass) =>
          pass.wgsl.includes("@fragment fn fs"),
        ),
      ).toBe(true);
    }
  });

  it("uses real two-pass source processing for Flow Glass and Wake Echo", () => {
    const processors = DESIGN_OWNED_DYNAMICS_DEFINITIONS.filter(
      (item) => item.kind === "processor",
    );
    expect(processors).toHaveLength(2);
    for (const processor of processors) {
      expect(processor.passes).toHaveLength(2);
      expect(processor.passes[0].reads).toEqual(["source"]);
      expect(processor.passes[1].reads).toEqual([
        "source",
        processor.passes[0].output,
      ]);
      expect(
        processor.resources?.some((item) => item.format === "rgba16float"),
      ).toBe(true);
    }
  });

  it("provides three distinct bounded stateful compute kernels for the engine-owned feedback ABI", () => {
    const kernels = Object.values(DESIGN_OWNED_FEEDBACK_KERNELS);
    expect(kernels).toHaveLength(3);
    expect(new Set(kernels).size).toBe(3);
    for (const kernel of kernels) {
      expect(kernel).toContain("@compute @workgroup_size(8, 8)");
      expect(kernel).toContain("textureLoad(priorTexture");
      expect(kernel).toContain("textureStore(nextTexture");
      expect(kernel).toContain("textureStore(displayTexture");
      expect(kernel).toContain("invocation.x >= 768u");
    }
    expect(DESIGN_OWNED_FEEDBACK_KERNELS.reactionField).toContain("lapU");
    expect(DESIGN_OWNED_FEEDBACK_KERNELS.waveMemory).toContain("velocity");
    expect(DESIGN_OWNED_FEEDBACK_RESOLVE_WGSL).toContain(
      "return mix(live, memory, resolve.blend)",
    );
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [...DESIGN_OWNED_STATEFUL_DEFINITIONS],
        instances: [],
        presets: [...DESIGN_OWNED_STATEFUL_PRESETS],
      }).errors,
    ).toEqual([]);
    for (const definition of DESIGN_OWNED_STATEFUL_DEFINITIONS) {
      expect(definition.provenance.origin).toBe("design-original");
      expect(definition.provenance.upstream).toBeUndefined();
      expect(planEffectGraph(definition).errors).toEqual([]);
      const adapted = adaptNativeFeedbackDefinition(definition);
      expect(adapted.ok).toBe(true);
      if (adapted.ok) {
        expect(adapted.definition.uniformProperties.intensity).not.toBe(
          "intensity",
        );
      }
    }
  });
});
