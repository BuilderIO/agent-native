import { describe, expect, it } from "vitest";

import { requiresProviderApiApproval } from "./provider-api-request.js";

describe("provider-api-request approval policy", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "requires approval for a Figma %s request",
    (method) => {
      expect(requiresProviderApiApproval({ provider: "figma", method })).toBe(
        true,
      );
    },
  );

  it.each(["GET", "HEAD"])(
    "allows a read-only Figma %s request without approval",
    (method) => {
      expect(requiresProviderApiApproval({ provider: "figma", method })).toBe(
        false,
      );
    },
  );

  it("does not change the existing approval behavior of other providers", () => {
    expect(
      requiresProviderApiApproval({ provider: "github", method: "POST" }),
    ).toBe(false);
  });
});
