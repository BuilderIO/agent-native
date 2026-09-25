import { describe, expect, it } from "vitest";

import { hasSameDomainCoworker } from "./plan-invite-suggestion";

describe("hasSameDomainCoworker", () => {
  it("matches a different member on the owner's domain case-insensitively", () => {
    expect(
      hasSameDomainCoworker("owner@Example.com", [
        "owner@example.com",
        "teammate@EXAMPLE.COM",
      ]),
    ).toBe(true);
  });

  it("does not count the owner or another domain", () => {
    expect(
      hasSameDomainCoworker("owner@example.com", [
        "owner@example.com",
        "teammate@other.com",
      ]),
    ).toBe(false);
  });

  it("rejects malformed owner email addresses", () => {
    expect(hasSameDomainCoworker("owner@@example.com", ["a@example.com"])).toBe(
      false,
    );
  });
});
