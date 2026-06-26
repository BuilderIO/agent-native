import { describe, expect, it } from "vitest";

import {
  normalizeTitleText,
  stripMarkdownHeadingPrefixFromTitlePaste,
} from "./title-text";

describe("title text normalization", () => {
  it("strips markdown heading prefixes from pasted title text", () => {
    expect(stripMarkdownHeadingPrefixFromTitlePaste("# Heading 1")).toBe(
      "Heading 1",
    );
    expect(stripMarkdownHeadingPrefixFromTitlePaste("### Heading 3")).toBe(
      "Heading 3",
    );
    expect(stripMarkdownHeadingPrefixFromTitlePaste("#### Heading 4")).toBe(
      "Heading 4",
    );
  });

  it("strips heading prefixes from each pasted line", () => {
    expect(
      stripMarkdownHeadingPrefixFromTitlePaste("## First\r\n### Second"),
    ).toBe("First\nSecond");
  });

  it("does not strip hashes that are not markdown heading prefixes", () => {
    expect(stripMarkdownHeadingPrefixFromTitlePaste("C# notes")).toBe(
      "C# notes",
    );
    expect(stripMarkdownHeadingPrefixFromTitlePaste("##No space")).toBe(
      "##No space",
    );
  });

  it("normalizes multiline title text to a single line", () => {
    expect(normalizeTitleText("First\nSecond")).toBe("First Second");
  });
});
