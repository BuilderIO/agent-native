import { describe, expect, it } from "vitest";

import { evaluatedFeatureFlagValues, featureFlagValue } from "./helpers.js";

describe("evaluatedFeatureFlagValues", () => {
  it("accepts the direct evaluated flag map", () => {
    expect(evaluatedFeatureFlagValues({ composer: true, beta: false })).toEqual(
      {
        composer: true,
        beta: false,
      },
    );
  });

  it("fails closed for absent or non-true flag values", () => {
    expect(
      featureFlagValue(evaluatedFeatureFlagValues(undefined), "beta"),
    ).toBe(false);
    expect(featureFlagValue({ beta: false }, "beta")).toBe(false);
    expect(featureFlagValue({ beta: true }, "missing")).toBe(false);
  });

  it("accepts the action response envelope", () => {
    expect(evaluatedFeatureFlagValues({ flags: { composer: true } })).toEqual({
      composer: true,
    });
    expect(evaluatedFeatureFlagValues({ values: { beta: false } })).toEqual({
      beta: false,
    });
  });
});
