import { describe, expect, it } from "vitest";

import { summarizeCreativeContextForChat } from "./generate-design.js";

describe("summarizeCreativeContextForChat", () => {
  it("reports Creative Context as off without listing any items", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [
          {
            kind: "document",
            label: "Should never surface",
            dataRole: "untrusted-reference",
          },
        ],
      }),
    ).toBe("Creative Context is off for this generation.");
  });

  it("reports no match when the resolved pack has no reuse labels", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "auto",
        contextPackId: null,
        reuseLabels: [],
      }),
    ).toBe("No matching Creative Context found — generating without it.");
  });

  it("lists the exact labels the resolved pack actually contains", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "auto",
        contextPackId: "pack_1",
        reuseLabels: [
          { kind: "brand", label: "Brand DNA", dataRole: "untrusted-reference" },
          {
            kind: "document",
            label: "Q3 style guide",
            dataRole: "untrusted-reference",
          },
        ],
      }),
    ).toBe("Found Creative Context: Brand DNA, Q3 style guide");
  });

  it("dedupes repeated labels instead of double-counting one item", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "auto",
        contextPackId: "pack_1",
        reuseLabels: [
          { kind: "brand", label: "Brand DNA", dataRole: "untrusted-reference" },
          { kind: "brand", label: "Brand DNA", dataRole: "untrusted-reference" },
        ],
      }),
    ).toBe("Found Creative Context: Brand DNA");
  });

  it("caps the inline list and counts the remainder instead of guessing", () => {
    expect(
      summarizeCreativeContextForChat({
        contextMode: "auto",
        contextPackId: "pack_1",
        reuseLabels: [
          { kind: "a", label: "One", dataRole: "untrusted-reference" },
          { kind: "b", label: "Two", dataRole: "untrusted-reference" },
          { kind: "c", label: "Three", dataRole: "untrusted-reference" },
          { kind: "d", label: "Four", dataRole: "untrusted-reference" },
          { kind: "e", label: "Five", dataRole: "untrusted-reference" },
        ],
      }),
    ).toBe("Found Creative Context: One, Two, Three, +2 more");
  });
});
