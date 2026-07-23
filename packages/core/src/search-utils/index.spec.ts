import { describe, expect, it } from "vitest";

import {
  buildSearchSnippet,
  escapeLikeTerm,
  matchesSearchMode,
  normalizeSearchTerms,
  scoreSearchText,
} from "./index.js";

describe("search utils", () => {
  it("normalizes a phrase and useful terms", () => {
    expect(
      normalizeSearchTerms("What did Platform decide about OAuth?"),
    ).toEqual([
      "what did platform decide about oauth",
      "platform",
      "decide",
      "oauth",
    ]);
  });

  it("supports every grep-style match mode", () => {
    const value = "A metrics slide with a dark bar chart";
    expect(matchesSearchMode(value, "metrics dark", "allTerms")).toBe(true);
    expect(matchesSearchMode(value, "metrics portrait", "anyTerm")).toBe(true);
    expect(matchesSearchMode(value, "dark bar chart", "phrase")).toBe(true);
    expect(matchesSearchMode(value, "metrics\\s+slide", "regex")).toBe(true);
    expect(matchesSearchMode(value, "[", "regex")).toBe(false);
    expect(matchesSearchMode("a".repeat(10_000), "(a+)+$", "regex")).toBe(
      false,
    );
    expect(matchesSearchMode(value, "a".repeat(241), "regex")).toBe(false);
  });

  it("weights title above summary and body", () => {
    const terms = normalizeSearchTerms("pricing");
    expect(scoreSearchText({ title: "Pricing" }, terms)).toBeGreaterThan(
      scoreSearchText({ summary: "Pricing" }, terms),
    );
    expect(scoreSearchText({ summary: "Pricing" }, terms)).toBeGreaterThan(
      scoreSearchText({ body: "Pricing" }, terms),
    );
  });

  it("builds bounded snippets and escapes LIKE wildcards", () => {
    expect(
      buildSearchSnippet("a".repeat(300), ["missing"], 20).length,
    ).toBeLessThanOrEqual(23);
    expect(escapeLikeTerm("a_b%\\c")).toBe("a\\_b\\%\\\\c");
  });
});
