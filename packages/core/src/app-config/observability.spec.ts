import { describe, expect, it } from "vitest";

import { observabilityConfig } from "./observability.js";

describe("observability configuration", () => {
  it("trims the build commit and leaves it unset by default", () => {
    expect(observabilityConfig.parse({}).buildSha).toBeUndefined();
    expect(observabilityConfig.parse({ buildSha: "  abc123 " }).buildSha).toBe(
      "abc123",
    );
  });

  it("rejects a blank or oversized build commit", () => {
    expect(() => observabilityConfig.parse({ buildSha: "   " })).toThrow();
    expect(() =>
      observabilityConfig.parse({ buildSha: "x".repeat(201) }),
    ).toThrow();
  });
});
