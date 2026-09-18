import { describe, expect, it } from "vitest";

import { buildCaseInsensitiveSearchPattern } from "./search-recordings-utils";

describe("buildCaseInsensitiveSearchPattern", () => {
  it("normalizes case while preserving LIKE literals", () => {
    expect(buildCaseInsensitiveSearchPattern("My_% Clip")).toBe(
      "%my\\_\\% clip%",
    );
  });
});
