import { describe, expect, it } from "vitest";

import {
  hasSameDomainCoworker,
  hasSameDomainCoworkerInPages,
} from "./plan-invite-suggestion";

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

  it("continues through member pages until it finds a same-domain coworker", async () => {
    const offsets: number[] = [];
    const found = await hasSameDomainCoworkerInPages(
      "owner@example.com",
      async (offset) => {
        offsets.push(offset);
        return offset === 0
          ? {
              members: [{ email: "owner@example.com" }],
              hasMore: true,
              nextOffset: 100,
            }
          : {
              members: [{ email: "teammate@example.com" }],
              hasMore: false,
              nextOffset: null,
            };
      },
    );

    expect(found).toBe(true);
    expect(offsets).toEqual([0, 100]);
  });
});
