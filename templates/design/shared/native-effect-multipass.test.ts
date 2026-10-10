import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import {
  BLOOM_EFFECT,
  GAUSSIAN_BLUR_EFFECT,
  gaussianWeights,
} from "./native-effect-multipass";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

describe("bounded Gaussian and bloom prototypes", () => {
  it("preserves the energy and symmetry of a premultiplied impulse at every supported kernel size", () => {
    for (let half = 1; half <= 24; half += 1) {
      const weights = gaussianWeights(half);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(
        1,
        12,
      );
      for (let i = 0; i <= half; i += 1) {
        expect(weights[i]).toBeGreaterThan(0);
        expect(weights[i]).toBeCloseTo(weights[weights.length - 1 - i], 12);
        if (i < half) expect(weights[i]).toBeLessThan(weights[i + 1]);
      }
      const alpha = 0.3;
      const premultipliedChannel = 0.7 * alpha;
      const blurredAlpha = weights.reduce(
        (sum, weight) => sum + alpha * weight,
        0,
      );
      const blurredColor = weights.reduce(
        (sum, weight) => sum + premultipliedChannel * weight,
        0,
      );
      expect(blurredColor / blurredAlpha).toBeCloseTo(0.7, 12);
    }
    for (const half of [0, 25, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => gaussianWeights(half)).toThrow(RangeError);
  });

  it("plans linear-float intermediates and keeps both sharp and blurred inputs alive until bloom composition", () => {
    for (const definition of [GAUSSIAN_BLUR_EFFECT, BLOOM_EFFECT])
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
        }).errors,
      ).toEqual([]);
    const plan = planEffectGraph(BLOOM_EFFECT);
    expect(plan.errors).toEqual([]);
    expect(plan.passes.map((pass) => pass.id)).toEqual([
      "bright",
      "horizontal",
      "vertical",
      "composite",
    ]);
    expect(
      plan.resources.find((resource) => resource.name === "source"),
    ).toMatchObject({ external: true, lastUse: 3 });
    expect(
      plan.resources.find((resource) => resource.name === "blurV"),
    ).toMatchObject({ format: "rgba16float", firstUse: 2, lastUse: 3 });
  });

  it("keeps zero radius and zero intensity explicit while rejecting radius beyond the declared halo", () => {
    const packed = packNativeProperties(BLOOM_EFFECT, {
      radius: 0,
      threshold: 1,
      knee: 0,
      intensity: 0,
    });
    expect(Array.from(packed.slice(0, 16))).toEqual([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const definition = structuredClone(GAUSSIAN_BLUR_EFFECT);
    const radius = definition.properties.radius;
    if (radius.type !== "float") throw new TypeError("Radius must be numeric.");
    radius.default = 25;
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      }).errors.length,
    ).toBeGreaterThan(0);
  });
});
