import { describe, expect, it } from "vitest";

import {
  factoryConfigRowId,
  triageConfigUpdateRowId,
} from "./factory-scope.js";

describe("triageConfigUpdateRowId", () => {
  it("uses the loaded config row id for legacy fallback rows", () => {
    expect(
      triageConfigUpdateRowId({ id: "org-1" }, "org-1", "product-feedback"),
    ).toBe("org-1");
  });

  it("falls back to the scoped config id when no row is loaded", () => {
    expect(
      triageConfigUpdateRowId(undefined, "org-1", "product-feedback"),
    ).toBe(factoryConfigRowId("org-1", "product-feedback"));
  });
});
