import { describe, expect, it } from "vitest";

import { isExpectedAuthFailure, publicAuthError } from "./auth.js";

// A hosted deployment that requires verified email without an email provider
// configured ends up with Better Auth's sign-up disabled. The register route
// must answer that with a typed, specific message instead of the generic
// "couldn't create your account" fallback.
describe("sign-up disabled copy", () => {
  it("treats a disabled sign-up as an expected failure", () => {
    expect(isExpectedAuthFailure({ message: "Sign up is disabled" })).toBe(
      true,
    );
    expect(isExpectedAuthFailure({ message: "SIGNUP_DISABLED" })).toBe(true);
  });

  it("names the disabled sign-up instead of the generic fallback", () => {
    const result = publicAuthError(
      { message: "Sign up is disabled" },
      "We couldn't create your account right now. Please try again.",
    );
    expect(result.statusCode).toBe(403);
    expect(result.code).toBe("SIGNUP_DISABLED");
    expect(result.message).toContain("isn't accepting new accounts");
  });
});
