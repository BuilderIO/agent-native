import { describe, expect, it } from "vitest";

import { ONBOARDING_ROLE_VALUES } from "../user-profile/shared.js";
import {
  decodeSharedOnboardingCookie,
  encodeSharedOnboardingCookie,
  hashOnboardingEmail,
} from "./shared-cookie.js";

/** Build a cookie value from an arbitrary payload, bypassing `encode`. */
function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("shared onboarding cookie codec", () => {
  it.each(ONBOARDING_ROLE_VALUES)("round-trips the %s role", (role) => {
    const raw = encodeSharedOnboardingCookie({
      role,
      email: "Alice@Example.com",
    });

    expect(decodeSharedOnboardingCookie(raw)).toEqual({
      role,
      emailHash: hashOnboardingEmail("alice@example.com"),
    });
  });

  it("round-trips an empty role", () => {
    const raw = encodeSharedOnboardingCookie({
      role: null,
      email: "alice@example.com",
    });

    expect(decodeSharedOnboardingCookie(raw)).toEqual({
      role: null,
      emailHash: hashOnboardingEmail("alice@example.com"),
    });
  });

  it("normalizes email case and whitespace", () => {
    expect(hashOnboardingEmail(" Alice@Example.com ")).toBe(
      hashOnboardingEmail("alice@example.com"),
    );
  });

  it.each([
    undefined,
    "",
    "garbage",
    encodePayload({ r: "design" }),
    encodePayload({ r: "design", e: "too-short" }),
    encodePayload([1, 2, 3]),
    encodePayload("a string"),
  ])("rejects malformed input %s", (raw) => {
    expect(decodeSharedOnboardingCookie(raw)).toBeNull();
  });

  // Forward compatibility is the whole reason this payload is JSON. A newer
  // sibling app writes fields this build has never seen; discarding the
  // completion over them would re-onboard everyone on the older app.
  it("honours a newer payload carrying unknown fields", () => {
    const emailHash = hashOnboardingEmail("alice@example.com");
    const raw = encodePayload({
      r: "design",
      e: emailHash,
      v: 2,
      workspaceTourSeen: true,
      nested: { anything: ["at", "all"] },
    });

    expect(decodeSharedOnboardingCookie(raw)).toEqual({
      role: "design",
      emailHash,
    });
  });

  it("keeps a custom role when a newer app writes one", () => {
    const emailHash = hashOnboardingEmail("alice@example.com");
    const raw = encodePayload({ r: "founder", e: emailHash });

    expect(decodeSharedOnboardingCookie(raw)).toEqual({
      role: "founder",
      emailHash,
    });
  });

  it("never throws on hostile input", () => {
    for (const raw of ["!!!!", "e30", "A".repeat(8192), "{}", "bnVsbA"]) {
      expect(() => decodeSharedOnboardingCookie(raw)).not.toThrow();
    }
  });
});
