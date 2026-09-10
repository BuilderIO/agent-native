import { describe, expect, it } from "vitest";

import { suggestJoinKey } from "./_join-suggestion";

describe("suggestJoinKey", () => {
  it("picks the overlapping url-like field pair and proposes a formula", () => {
    const suggestion = suggestJoinKey({
      primaryValues: [
        { "data.url": "https://site.com/blog/foo", "data.title": "Foo" },
        { "data.url": "https://site.com/blog/bar", "data.title": "Bar" },
        { "data.url": "https://site.com/blog/baz", "data.title": "Baz" },
      ],
      secondaryValues: [
        { ref_url: "https://site.com/blog/foo", editor: "Jordan" },
        { ref_url: "https://site.com/blog/bar", editor: "Priya" },
        { ref_url: "https://other.com/blog/qux", editor: "Sam" },
      ],
    });

    expect(suggestion).not.toBeNull();
    expect(suggestion!.primary.keyField).toBe("data.url");
    expect(suggestion!.secondary.keyField).toBe("ref_url");
    expect(suggestion!.primary.normalizationFormula).toContain("striphost");
    // foo + bar overlap of 3∪3 with 2 shared → 2/4 = 0.5.
    expect(suggestion!.confidence).toBeGreaterThan(0);
    const matched = suggestion!.sampleMatches.filter((m) => m.matched);
    expect(matched.length).toBe(2);
    expect(matched[0].normalized).toBe("/blog/foo");
  });

  it("returns null when nothing overlaps", () => {
    const suggestion = suggestJoinKey({
      primaryValues: [{ "data.url": "/blog/foo" }],
      secondaryValues: [{ ref_url: "/totally/different" }],
    });
    expect(suggestion).toBeNull();
  });

  it("normalizes absolute and relative URL-like fields with the same formula", () => {
    const suggestion = suggestJoinKey({
      primaryValues: [
        { canonical: "https://site.com/blog/foo?utm=campaign" },
        { canonical: "https://site.com/blog/bar/" },
      ],
      secondaryValues: [{ path: "/blog/foo" }, { path: "/blog/bar" }],
    });

    expect(suggestion).not.toBeNull();
    expect(suggestion!.primary.normalizationFormula).toContain("striphost");
    expect(suggestion!.secondary.normalizationFormula).toContain("striphost");
    expect(
      suggestion!.sampleMatches.filter((match) => match.matched),
    ).toHaveLength(2);
  });

  it("prefers the higher-overlap field even when a weak field also overlaps", () => {
    const suggestion = suggestJoinKey({
      primaryValues: [
        { slug: "foo", category: "news" },
        { slug: "bar", category: "news" },
      ],
      secondaryValues: [
        { ref: "foo", kind: "news" },
        { ref: "bar", kind: "tech" },
      ],
    });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.primary.keyField).toBe("slug");
    expect(suggestion!.secondary.keyField).toBe("ref");
  });

  it("matches Builder reference values to the referenced collection id", () => {
    const suggestion = suggestJoinKey({
      primaryValues: [
        { "data.author": "blog-author:alice" },
        { "data.author": "blog-author:bob" },
      ],
      secondaryValues: [{ id: "alice" }, { id: "bob" }],
    });

    expect(suggestion).not.toBeNull();
    expect(suggestion!.primary.keyField).toBe("data.author");
    expect(suggestion!.secondary.keyField).toBe("id");
    expect(suggestion!.primary.normalizationFormula).toContain("regexreplace");
    expect(
      suggestion!.sampleMatches.filter((match) => match.matched),
    ).toHaveLength(2);
  });

  it("prefers author names over low-information published status overlap", () => {
    const suggestion = suggestJoinKey({
      primaryValues: [
        { "data.author": "Alice Moore", published: "published" },
        { "data.author": "Steve Sewell", published: "published" },
        { "data.author": "Amy Cross", published: "published" },
      ],
      secondaryValues: [
        { "data.fullName": "Alice Moore", published: "published" },
        { "data.fullName": "Amy Cross", published: "published" },
        { "data.fullName": "Josh Adams", published: "published" },
      ],
    });

    expect(suggestion).not.toBeNull();
    expect(suggestion!.primary.keyField).toBe("data.author");
    expect(suggestion!.secondary.keyField).toBe("data.fullName");
  });
});
