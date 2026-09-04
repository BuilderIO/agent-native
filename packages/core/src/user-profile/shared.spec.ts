import { describe, expect, it } from "vitest";

import { isEmailDerivedName } from "./shared.js";

describe("isEmailDerivedName", () => {
  it("recognizes Content's formatted local-part fallback", () => {
    expect(isEmailDerivedName("John Doe", "john.doe@example.com")).toBe(true);
    expect(isEmailDerivedName("John Doe", "john-doe@example.com")).toBe(true);
    expect(isEmailDerivedName("John Doe", "john_doe@example.com")).toBe(true);
    expect(isEmailDerivedName("John Smith", "john.doe@example.com")).toBe(
      false,
    );
  });
});
