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
  // A finite outer repeat still re-splits the input across its iterations.
  // This one does not return on a 41-character non-match.
  "^(a+){10}$",
  // Duplicate multi-character alternatives: an indistinguishable choice on
  // every iteration, the same fan-out as `(a|a)+` without being single atoms.
  "^(ab|ab)+$",
  "^(abc|abc|x)+$",
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
  // A finite repeat of an unambiguous body is fine — the group has only one
  // way to split each iteration, so checking `max > 1` must not reject it.
  "^(\\d{2}){3}$",
  "^([A-Z]-)+\\d$",
  // Equal-length alternatives that differ somewhere: one way to match, not two.
  "^(ab|ac)+$",
  "^(GET|PUT)$",
  // Lookarounds match a position, not text, so the standard password rule is
  // three assertions and one repetition, not four competing repetitions.
  "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$",
  // A body that can only take one character has nothing to hand back and forth
  // between iterations. Both measure 0 ms on a non-matching 41-character value.
  "^(a?)+$",
  "^[A-Z]{2}\\d{2}[A-Z0-9]{4}\\d{7}([A-Z0-9]?){0,16}$",
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

  it("carries dotAll and unicode into the character-set probes", () => {
    // Slides runs a regex-replace with the agent's own flags. `.` overlaps the
    // alternative only under `s` (7s on a 29-character non-match), and `ſ`
    // folds onto `s` only under `iu` (2s on 25 characters). Analyzing without
    // those flags clears both.
    expect(analyzeRegexSource("^(.|\\n)+Z$", "").safe).toBe(true);
    expect(analyzeRegexSource("^(.|\\n)+Z$", "s").safe).toBe(false);
    expect(analyzeRegexSource("^(ſ|s)+Z$", "i").safe).toBe(true);
    expect(analyzeRegexSource("^(ſ|s)+Z$", "iu").safe).toBe(false);
  });

  it("reads a unicode property escape as one atom", () => {
    // `\p{L}` parsed as `\p` plus a literal `{L}` leaves a stray `}` holding
    // the quantifier, so the verdict describes a pattern nobody wrote.
    expect(analyzeRegexSource("^\\p{L}+$", "u")).toEqual({ safe: true });
    expect(analyzeRegexSource("^\\p{L}+ \\p{L}+$", "u")).toEqual({
      safe: true,
    });
    const nested = analyzeRegexSource("^(\\p{L}+)+$", "u");
    expect(nested.safe).toBe(false);
    if (!nested.safe) expect(nested.reason).toContain("\\p{L}");
  });

  it("refuses a pattern too long to analyze cheaply", () => {
    // The pair-wise alternative comparison is super-linear in the source
    // length: 800 branches took 15s before this cap. Callers that reach the
    // analyzer directly must not be able to trade a slow match for a slow
    // verdict.
    const branches = Array.from({ length: 400 }, (_, i) => `a${i}`).join("|");
    const source = `^(${branches})+$`;
    expect(source.length).toBeGreaterThan(MAX_USER_REGEX_LENGTH);
    const started = Date.now();
    expect(analyzeRegexSource(source).safe).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
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

  it("rejects quadratic overlap when the caller cannot cap input", () => {
    expect(analyzeRegexSource("^(a+)(a+)$").safe).toBe(true);
    const verdict = analyzeRegexSource("^(a+)(a+)$", "", {
      inputBounded: false,
    });
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("quadratically");
  });

  it("rejects numeric and named backreferences for uncapped callers", () => {
    for (const source of ["^(a+)\\1+$", "^(?<word>a+)\\k<word>+$"]) {
      expect(analyzeRegexSource(source).safe).toBe(true);
      const verdict = analyzeRegexSource(source, "", { inputBounded: false });
      expect(verdict.safe).toBe(false);
      if (!verdict.safe) expect(verdict.reason).toContain("backreference");
    }
  });

  it("rejects variable-length lookarounds for uncapped callers", () => {
    const source = "^(a+)(?=a+$)";
    expect(analyzeRegexSource(source).safe).toBe(true);
    const verdict = analyzeRegexSource(source, "", { inputBounded: false });
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("lookaround");
  });

  it("rejects nullable separators for uncapped callers", () => {
    const source = "^a+b*a+$";
    expect(analyzeRegexSource(source).safe).toBe(true);
    const verdict = analyzeRegexSource(source, "", { inputBounded: false });
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("nullable separator");
  });

  it("rejects unicode-set string alternatives for uncapped callers", () => {
    const source = String.raw`^[\q{a|aa}]+$`;
    expect(analyzeRegexSource(source, "v").safe).toBe(true);
    const verdict = analyzeRegexSource(source, "v", { inputBounded: false });
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("string alternatives");
  });

  it("rejects finite repetitions larger than the input cap", () => {
    const source = "^(a?){5000000}$";
    const verdict = analyzeRegexSource(source);
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("finite repetition");
    expect(compileUserRegex(source).status).toBe("unsafe");
    expect(testUserRegex(source, "").status).toBe("unevaluated");
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
