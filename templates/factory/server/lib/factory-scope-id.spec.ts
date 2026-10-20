import { describe, expect, it } from "vitest";

import { factoryIdCandidateWithSuffix } from "./factory-scope.js";

describe("factory id suffix candidates", () => {
  it("keeps distinct candidates when the base fills the max length", () => {
    const base = "a".repeat(120);
    const second = factoryIdCandidateWithSuffix(base, 2);
    const third = factoryIdCandidateWithSuffix(base, 3);
    expect(second).not.toBe(third);
    expect(second.length).toBeLessThanOrEqual(120);
    expect(third.length).toBeLessThanOrEqual(120);
    expect(second.endsWith("-2")).toBe(true);
    expect(third.endsWith("-3")).toBe(true);
  });
});
