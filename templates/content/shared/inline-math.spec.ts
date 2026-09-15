import { describe, expect, it } from "vitest";

import { findTrailingPlainInlineMath, matchInlineMathAt } from "./inline-math";

describe("inline math delimiters", () => {
  it("matches canonical and GitHub-style syntax", () => {
    expect(matchInlineMathAt("$E = mc^2$", 0)).toMatchObject({
      latex: "E = mc^2",
      syntax: "plain",
      to: 10,
    });
    expect(matchInlineMathAt("$`E = mc^2`$", 0)).toMatchObject({
      latex: "E = mc^2",
      syntax: "github",
      to: 12,
    });
  });

  it("applies Pandoc-style whitespace and currency guards", () => {
    expect(matchInlineMathAt("$ x $", 0)).toBeNull();
    expect(matchInlineMathAt("$x $", 0)).toBeNull();
    expect(matchInlineMathAt("$20,000 and $30,000", 0)).toBeNull();
    expect(matchInlineMathAt("$x$2", 0)).toBeNull();
  });

  it("ignores escaped and display delimiters", () => {
    expect(matchInlineMathAt("\\$x$", 1)).toBeNull();
    expect(matchInlineMathAt("$$x$$", 0)).toBeNull();
    expect(matchInlineMathAt("$x\\$y$", 0)).toMatchObject({
      latex: "x\\$y",
      syntax: "plain",
    });
  });

  it("finds only a completed canonical expression at the cursor", () => {
    expect(findTrailingPlainInlineMath("Energy $E = mc^2$")).toMatchObject({
      from: 7,
      latex: "E = mc^2",
    });
    expect(findTrailingPlainInlineMath("Energy $E = mc^2$ after")).toBeNull();
    expect(findTrailingPlainInlineMath("Energy $`E = mc^2`$")).toBeNull();
    expect(findTrailingPlainInlineMath("`code $x$")).toBeNull();
  });
});
