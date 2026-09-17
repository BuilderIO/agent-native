import { describe, expect, it } from "vitest";

import { applyBacktrack, BacktrackBuffer } from "./backtrack";

describe("applyBacktrack punctuation-by-name", () => {
  it("converts the pre-existing basic punctuation names", () => {
    expect(applyBacktrack("hello period")).toBe("hello.");
    expect(applyBacktrack("wait comma really")).toBe("wait, really");
    expect(applyBacktrack("is that true question mark")).toBe("is that true?");
    expect(applyBacktrack("wow exclamation point")).toBe("wow!");
    expect(applyBacktrack("notes colon apples")).toBe("notes: apples");
    expect(applyBacktrack("first semicolon second")).toBe("first; second");
  });

  it("converts quotation mark", () => {
    expect(applyBacktrack("she said quotation mark hello quotation mark")).toBe(
      'she said " hello "',
    );
  });

  it("converts em dash", () => {
    expect(applyBacktrack("hello em dash world")).toBe("hello — world");
  });

  it("converts en dash", () => {
    expect(applyBacktrack("pages ten en dash twenty")).toBe(
      "pages ten – twenty",
    );
  });

  it("converts asterisk", () => {
    expect(applyBacktrack("bullet asterisk item one")).toBe(
      "bullet * item one",
    );
  });

  it("converts ampersand", () => {
    expect(applyBacktrack("salt ampersand pepper")).toBe("salt & pepper");
  });

  it("converts ellipsis", () => {
    expect(applyBacktrack("and then ellipsis")).toBe("and then …");
  });

  it("converts open paren and close paren", () => {
    expect(
      applyBacktrack("see the appendix open paren page ten close paren"),
    ).toBe("see the appendix ( page ten )");
  });

  it("matches whole words only, not substrings", () => {
    // "asterisked" should not trigger the "asterisk" mapping.
    expect(applyBacktrack("the field is asterisked")).toBe(
      "the field is asterisked",
    );
  });

  it("converts a plain mid-sentence mention the same as existing entries", () => {
    // PUNCTUATION_BY_NAME has no guard against a literal mention of the
    // word itself (colon/semicolon have the same accepted tradeoff) — a
    // dictated sentence that talks ABOUT the symbol still converts it.
    // This documents current, intentional behavior rather than a new gap.
    expect(applyBacktrack("we used an asterisk in the doc")).toBe(
      "we used an * in the doc",
    );
  });
});

describe("applyBacktrack backtrack phrases", () => {
  it("scratches back to the last sentence boundary", () => {
    expect(
      applyBacktrack("Let's meet Tuesday. Actually scratch that Wednesday"),
    ).toBe("Let's meet Tuesday. Wednesday");
  });

  it("deletes the last word before the phrase", () => {
    // "delete word" drops the word immediately preceding it ("report"),
    // not the word that follows.
    expect(applyBacktrack("send the report delete word today")).toBe(
      "send the today",
    );
  });

  it("inserts a newline for new line", () => {
    expect(applyBacktrack("first part new line second part")).toBe(
      "first part\n second part",
    );
  });
});

describe("BacktrackBuffer", () => {
  it("applies backtrack rules on finalize", () => {
    const buffer = new BacktrackBuffer();
    buffer.update("hello comma world");
    expect(buffer.finalize()).toBe("hello, world");
  });
});
