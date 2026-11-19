import { describe, expect, it } from "vitest";

import {
  buildSearchSnippet,
  createTextMatcher,
  escapeLikeTerm,
  likeContainsPattern,
  likeEndsWithPattern,
  likeStartsWithPattern,
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

  it("supports bounded literal, glob, SQL-like, and regex patterns", () => {
    expect(createTextMatcher("AgentPanel").matches("AgentPanel.tsx")).toBe(
      true,
    );
    expect(
      createTextMatcher("templates/*/actions/*.ts", "glob").matches(
        "templates/chat/actions/hello.ts",
      ),
    ).toBe(true);
    expect(
      createTextMatcher("templates/%/actions/%.ts", "sql-like").matches(
        "templates/chat/actions/hello.ts",
      ),
    ).toBe(true);
    expect(
      createTextMatcher("Agent(?:Panel|Sidebar)", "regex").matches(
        "AgentSidebar.tsx",
      ),
    ).toBe(true);
    expect(createTextMatcher("[", "regex").error).toContain("Invalid");
    expect(createTextMatcher("a".repeat(241), "glob").error).toContain(
      "limited",
    );
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

  // The fleet's one literal-containment rule: a typed query matches its own
  // characters. A wildcard in the query would make `%` match every row and `_`
  // match any single character, which is a wrong result a reader cannot explain.
  it("builds LIKE patterns that match the query literally", () => {
    expect(likeContainsPattern("Acme")).toBe("%Acme%");
    expect(likeContainsPattern("50%")).toBe("%50\\%%");
    expect(likeContainsPattern("a_b")).toBe("%a\\_b%");
    expect(likeContainsPattern("back\\slash")).toBe("%back\\\\slash%");
    expect(likeContainsPattern("%_\\")).toBe("%\\%\\_\\\\%");

    expect(likeStartsWithPattern("50%")).toBe("50\\%%");
    expect(likeEndsWithPattern("50%")).toBe("%50\\%");
  });

  it("keeps a literal query from widening to every row", () => {
    // The defect this rule prevents: an unescaped `%` in a contains pattern
    // matches every value. `likeMatches` mirrors SQL LIKE (backslash escapes,
    // `%` any run, `_` one character) so the claim is measured, not assumed.
    const likeMatches = (pattern: string, value: string) => {
      let source = "^";
      for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index]!;
        if (character === "\\") {
          index += 1;
          source += (pattern[index] ?? "").replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
        } else if (character === "%") {
          source += "[\\s\\S]*";
        } else if (character === "_") {
          source += "[\\s\\S]";
        } else {
          source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
      }
      return new RegExp(`${source}$`, "u").test(value);
    };

    expect(likeMatches("%" + "%" + "%", "Acme Ltd")).toBe(true);
    expect(likeMatches("%" + "_" + "%", "Acme Ltd")).toBe(true);
    expect(likeMatches(likeContainsPattern("%"), "Acme Ltd")).toBe(false);
    expect(likeMatches(likeContainsPattern("_"), "Acme Ltd")).toBe(false);
    expect(likeMatches(likeContainsPattern("%"), "100% margins")).toBe(true);
    expect(likeMatches(likeContainsPattern("50%"), "50% off")).toBe(true);
    expect(likeMatches(likeContainsPattern("50%"), "50 off")).toBe(false);
    expect(likeMatches(likeContainsPattern("off"), "50% off")).toBe(true);
  });
});
