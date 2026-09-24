import { describe, expect, it } from "vitest";

import { parseSearchQuery, searchQueryNeedles } from "./search-query";

describe("parseSearchQuery", () => {
  it("treats bare words as implicit AND", () => {
    const parsed = parseSearchQuery("quarterly  report");
    expect(
      parsed.groups.map((group) => group.terms.map((term) => term.text)),
    ).toEqual([["quarterly"], ["report"]]);
    expect(parsed.negatives).toEqual([]);
    expect(parsed.empty).toBe(false);
  });

  it("matches quoted phrases contiguously", () => {
    const parsed = parseSearchQuery('"quarterly report" draft');
    expect(parsed.groups[0]!.terms[0]).toMatchObject({
      text: "quarterly report",
      phrase: true,
      negated: false,
      titleOnly: false,
    });
    expect(parsed.groups[1]!.terms[0]!.text).toBe("draft");
  });

  it("treats an unclosed quote as a phrase to the end", () => {
    const parsed = parseSearchQuery('look for "open note');
    expect(parsed.groups[2]!.terms[0]!.text).toBe("open note");
    expect(parsed.groups[2]!.terms[0]!.phrase).toBe(true);
  });

  it("supports negated words and phrases", () => {
    const parsed = parseSearchQuery('report -draft -"status update"');
    expect(parsed.groups.map((group) => group.terms[0]!.text)).toEqual([
      "report",
    ]);
    expect(parsed.negatives.map((term) => term.text)).toEqual([
      "draft",
      "status update",
    ]);
    expect(parsed.negatives[1]!.phrase).toBe(true);
  });

  it("joins OR-neighboring terms into one alternation group", () => {
    const parsed = parseSearchQuery("memo OR report OR memo2 extra");
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0]!.terms.map((term) => term.text)).toEqual([
      "memo",
      "report",
      "memo2",
    ]);
    expect(parsed.groups[1]!.terms.map((term) => term.text)).toEqual(["extra"]);
  });

  it("treats lowercase or as a search word", () => {
    const parsed = parseSearchQuery("cats or dogs");
    expect(parsed.groups.map((group) => group.terms[0]!.text)).toEqual([
      "cats",
      "or",
      "dogs",
    ]);
  });

  it("restricts intitle: terms to the title", () => {
    const parsed = parseSearchQuery('intitle:kickoff intitle:"launch plan"');
    expect(parsed.groups[0]!.terms[0]).toMatchObject({
      text: "kickoff",
      titleOnly: true,
    });
    expect(parsed.groups[1]!.terms[0]).toMatchObject({
      text: "launch plan",
      titleOnly: true,
      phrase: true,
    });
  });

  it("keeps % and _ as literal text, not wildcards", () => {
    const parsed = parseSearchQuery("100%_match");
    expect(parsed.groups[0]!.terms[0]!.text).toBe("100%_match");
  });

  it("flags punctuation-only queries as empty", () => {
    for (const query of ["-", '""', "- ", "   "]) {
      expect(parseSearchQuery(query).empty).toBe(true);
    }
    expect(parseSearchQuery("-draft").empty).toBe(false);
  });

  it("collects only positive needles for highlighting", () => {
    expect(
      searchQueryNeedles(parseSearchQuery('"status hub" -draft intitle:qa')),
    ).toEqual(["status hub", "qa"]);
    expect(searchQueryNeedles(parseSearchQuery("   "))).toEqual([]);
  });
});
