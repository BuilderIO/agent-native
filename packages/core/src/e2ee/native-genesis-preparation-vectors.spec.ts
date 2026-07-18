import { describe, expect, it } from "vitest";

import {
  ANC_V1_NATIVE_GENESIS_PREPARATION_RECIPE,
  buildAncV1NativeGenesisPreparationRuntimeVector,
} from "./native-genesis-preparation-vectors.js";

describe("native genesis preparation runtime vector", () => {
  it("materializes exact public artifacts without a persisted secret fixture", async () => {
    const value = await buildAncV1NativeGenesisPreparationRuntimeVector();
    try {
      expect(ANC_V1_NATIVE_GENESIS_PREPARATION_RECIPE.schema).toContain(
        "runtime",
      );
      expect(value.secretInputs.map((field) => field.length)).toEqual([
        32, 32, 32, 32,
      ]);
      expect(value.expected.every((field) => field.length > 0)).toBe(true);
    } finally {
      for (const secret of value.secretInputs) secret.fill(0);
    }
  });
});
