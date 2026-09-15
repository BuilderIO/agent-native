import { describe, it, expect } from "vitest";

import {
  MAX_USER_REGEX_INPUT_LENGTH,
  MAX_USER_REGEX_LENGTH,
  analyzeRegexSource,
  compileUserRegex,
  testUserRegex,
} from "./bounded-regex.js";

/**
 * The reported hang came from an agent writing a validation rule for "Full Name
 * must be at least two words". These are the patterns an LLM actually produces
 * for that request; the exponential ones are the bug.
 */
const CATASTROPHIC = [
  "^([A-Za-z]+\\s?)+$",
  "^([A-Za-z]+(\\s|-|')?)+[A-Za-z]+$",
  "^(a+)+$",
  "^(\\w+)+$",
  "^([a-z]*)*$",
  "^(a|a)*$",
  "^(\\d|\\w)+$",
  "^(\\s*\\S+)*$",
  // Letters outside the baseline probe alphabet. These read as unambiguous
  // while the analyzer only probed a fixed character list, so the corpus above
  // passed while `^(A+)+$` still hung.
  "^(A+)+$",
  "^(Q+)+$",
  "^(x|x)+$",
  // Overlapping alternatives of differing length.
  "^(a|aa)+$",
  // Finite inner quantifier: bounded is not the same as unambiguous.
  "^(a{1,10})+$",
  // Three chained repetitions over the same characters: cubic, and over 20
  // seconds at the input cap even though no single group is ambiguous.
  "^(a+)(a+)(a+)$",
];

/** Patterns that must keep working — including correct "two words" rules. */
const LINEAR = [
  "^\\s*\\S+(\\s+\\S+)+\\s*$",
  "^\\w+(\\s+\\w+)+$",
  "^(\\w+\\s+)+\\w+$",
  "^([a-zA-Z]+ )+[a-zA-Z]+$",
  "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
  "^\\d{3}-\\d{3}-\\d{4}$",
  "^(\\+\\d{1,3}\\s?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$",
  "^[A-Z]{2}\\d{4}$",
  "^(cat|car)+$",
  "^https?://\\S+$",
  "^.{8,64}$",
  "^(?:Mr|Mrs|Ms|Dr)\\.? [A-Za-z]+$",
  // Disjoint case-sensitively, and only dangerous once `i` is applied.
  "^(a|A)+$",
  "^#[0-9a-fA-F]{6}$",
  "^[A-Z]{3}-[0-9]{4}$",
  "^\\S+@\\S+\\.\\S+$",
];

/** Long enough that an exponential pattern would not return this decade. */
const HOSTILE_INPUT =
  "Jonathan Alexander Montgomery Wellington Fitzgerald Smith Junior Esquire!";

describe("analyzeRegexSource", () => {
  it.each(CATASTROPHIC)("rejects the super-linear pattern %s", (source) => {
    const verdict = analyzeRegexSource(source);
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toBeTruthy();
  });

  it.each(LINEAR)("accepts the linear pattern %s", (source) => {
    expect(analyzeRegexSource(source)).toEqual({ safe: true });
  });

  it("folds case when the pattern will run with the i flag", () => {
    // Same source, opposite verdicts. Analyzing without the caller's flags
    // answers a different question than the one that gets executed.
    expect(analyzeRegexSource("^(a|A)+$", "").safe).toBe(true);
    expect(analyzeRegexSource("^(a|A)+$", "i").safe).toBe(false);
    expect(analyzeRegexSource("^([a-z]|[A-Z])+$", "i").safe).toBe(false);
  });

  it("fails closed on a construct it cannot characterize", () => {
    // A backreference cannot be reduced to a character set, so it must not be
    // reported as provably disjoint from its neighbour.
    expect(analyzeRegexSource("^(\\w)(\\1+)+$").safe).toBe(false);
  });

  it("keeps a single overlapping pair, which is only quadratic", () => {
    // Two chained repetitions stay inside the input cap; only three or more
    // exceed it. Rejecting pairs would take the standard email pattern with it.
    expect(analyzeRegexSource("^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$").safe).toBe(
      true,
    );
  });

  it("refuses to clear a pattern it cannot parse", () => {
    expect(analyzeRegexSource("^(unclosed").safe).toBe(false);
  });
});

describe("compileUserRegex", () => {
  it("returns a usable regex for a safe pattern", () => {
    const result = compileUserRegex("^\\w+(\\s+\\w+)+$");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.regex.test("Ada Lovelace")).toBe(true);
      expect(result.regex.test("Ada")).toBe(false);
    }
  });

  it("separates invalid syntax from an unsafe shape", () => {
    expect(compileUserRegex("^[a-").status).toBe("invalid-syntax");
    expect(compileUserRegex("^([A-Za-z]+\\s?)+$").status).toBe("unsafe");
  });

  it("rejects an over-long pattern before compiling it", () => {
    const result = compileUserRegex("a".repeat(MAX_USER_REGEX_LENGTH + 1));
    expect(result.status).toBe("too-long");
  });
});

describe("testUserRegex", () => {
  it("evaluates a safe pattern normally", () => {
    expect(testUserRegex("^\\w+(\\s+\\w+)+$", "Ada Lovelace")).toEqual({
      status: "match",
    });
    expect(testUserRegex("^\\w+(\\s+\\w+)+$", "Ada")).toEqual({
      status: "no-match",
    });
  });

  it("reports an unsafe pattern as unevaluated, never as no-match", () => {
    const result = testUserRegex("^([A-Za-z]+\\s?)+$", HOSTILE_INPUT);
    expect(result.status).toBe("unevaluated");
    // The distinction is the whole point: a caller must not be able to read
    // "we refused to run this" as "the value failed the rule".
    expect(result.status).not.toBe("no-match");
  });

  it("reports an over-long value as unevaluated", () => {
    const result = testUserRegex(
      "^\\w+$",
      "a".repeat(MAX_USER_REGEX_INPUT_LENGTH + 1),
    );
    expect(result.status).toBe("unevaluated");
  });

  it("returns within a bounded time for the pattern that froze the tab", () => {
    const started = Date.now();
    for (const source of CATASTROPHIC) {
      expect(testUserRegex(source, HOSTILE_INPUT).status).toBe("unevaluated");
    }
    // Unguarded, the first pattern alone does not finish in this millennium.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
