import { describe, it, expect } from "vitest";

import {
  MAX_USER_REGEX_INPUT_LENGTH,
  MAX_USER_REGEX_LENGTH,
  analyzeRegexSource,
  compileUserRegex,
  testUserRegex,
} from "./bounded-regex.js";

const CATASTROPHIC = [
  "^([A-Za-z]+\\s?)+$",
  "^([A-Za-z]+(\\s|-|')?)+[A-Za-z]+$",
  "^(a+)+$",
  "^(\\w+)+$",
  "^([a-z]*)*$",
  "^(a|a)*$",
  "^(\\d|\\w)+$",
  "^(\\s*\\S+)*$",
  "^(A+)+$",
  "^(Q+)+$",
  "^(x|x)+$",
  "^(a|aa)+$",
  "^(a{1,10})+$",
  "^(a+)(a+)(a+)$",
  "^(a+){10}$",
  "^(ab|ab)+$",
  "^(abc|abc|x)+$",
];

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
  "^(a|A)+$",
  "^#[0-9a-fA-F]{6}$",
  "^[A-Z]{3}-[0-9]{4}$",
  "^\\S+@\\S+\\.\\S+$",
  "^(\\d{2}){3}$",
  "^([A-Z]-)+\\d$",
  "^(ab|ac)+$",
  "^(GET|PUT)$",
  "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$",
  "^(a?)+$",
  "^[A-Z]{2}\\d{2}[A-Z0-9]{4}\\d{7}([A-Z0-9]?){0,16}$",
];

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
    expect(analyzeRegexSource("^(a|A)+$", "").safe).toBe(true);
    expect(analyzeRegexSource("^(a|A)+$", "i").safe).toBe(false);
    expect(analyzeRegexSource("^([a-z]|[A-Z])+$", "i").safe).toBe(false);
  });

  it("carries dotAll and unicode into the character-set probes", () => {
    expect(analyzeRegexSource("^(.|\\n)+Z$", "").safe).toBe(true);
    expect(analyzeRegexSource("^(.|\\n)+Z$", "s").safe).toBe(false);
    expect(analyzeRegexSource("^(ſ|s)+Z$", "i").safe).toBe(true);
    expect(analyzeRegexSource("^(ſ|s)+Z$", "iu").safe).toBe(false);
  });

  it("reads a unicode property escape as one atom", () => {
    expect(analyzeRegexSource("^\\p{L}+$", "u")).toEqual({ safe: true });
    expect(analyzeRegexSource("^\\p{L}+ \\p{L}+$", "u")).toEqual({
      safe: true,
    });
    const nested = analyzeRegexSource("^(\\p{L}+)+$", "u");
    expect(nested.safe).toBe(false);
    if (!nested.safe) expect(nested.reason).toContain("\\p{L}");
  });

  it("refuses a pattern too long to analyze cheaply", () => {
    const branches = Array.from({ length: 400 }, (_, i) => `a${i}`).join("|");
    const source = `^(${branches})+$`;
    expect(source.length).toBeGreaterThan(MAX_USER_REGEX_LENGTH);
    const started = Date.now();
    expect(analyzeRegexSource(source).safe).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("fails closed on a construct it cannot characterize", () => {
    expect(analyzeRegexSource("^(\\w)(\\1+)+$").safe).toBe(false);
  });

  it("keeps a single overlapping pair, which is only quadratic", () => {
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
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
