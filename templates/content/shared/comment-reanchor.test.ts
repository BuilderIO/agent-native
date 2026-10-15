import { describe, expect, it } from "vitest";

import { reanchoredCommentQuote } from "./comment-reanchor";

const before =
  "Our editor is fast.\n\nThe team ships every Friday afternoon, so feedback lands before the weekend.\n";
// Captured from the editor text, which joins blocks with no separator.
const quote = {
  quotedText: "ships every Friday afternoon",
  prefix: "Our editor is fast.The team ",
  suffix: ", so feedback lands before the w",
  startOffset: 28,
};

describe("reanchoredCommentQuote", () => {
  it("follows an edit inside the quote and keeps its surroundings", () => {
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace("Friday afternoon", "Thursday at 3:00 PM UTC"),
      ),
    ).toEqual({ ...quote, quotedText: "ships every Thursday at 3:00 PM UTC" });
  });

  it("widens the quote over an edit that runs past it", () => {
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace("afternoon, so feedback", "at 3 PM, so all feedback"),
      ),
    ).toEqual({
      quotedText: "ships every Friday at 3 PM, so all",
      prefix: "Our editor is fast.The team ",
      suffix: " feedback lands before the weeke",
      startOffset: 28,
    });
  });

  it("moves the start offset with an edit that begins before the quote", () => {
    expect(
      reanchoredCommentQuote(
        {
          quotedText: "every Friday",
          prefix: "Our editor is fast.The team ships ",
          suffix: " afternoon, so feedback lands be",
          startOffset: 34,
        },
        before,
        before.replace("team ships every", "crew sends each"),
      ),
    ).toEqual({
      quotedText: "crew sends each Friday",
      prefix: "Our editor is fast.The ",
      suffix: " afternoon, so feedback lands be",
      startOffset: 23,
    });
  });

  it("leaves a quote the edit did not cut into", () => {
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace("before the weekend", "on Monday"),
      ),
    ).toBeNull();
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace(
          "ships every Friday afternoon",
          "ships every Friday afternoon!",
        ),
      ),
    ).toBeNull();
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace("Friday", "**Friday**"),
      ),
    ).toBeNull();
  });

  it("re-anchors only the comment's own copy of a repeated quote", () => {
    const page = "Ship on Friday.\n\nReview on Friday afternoon.\n";
    const edited = page.replace("on Friday afternoon", "on Thursday afternoon");
    const first = {
      quotedText: "Friday",
      prefix: "Ship on ",
      suffix: ".Review on Friday afternoon.",
      startOffset: 8,
    };
    const second = {
      quotedText: "Friday",
      prefix: "Ship on Friday.Review on ",
      suffix: " afternoon.",
      startOffset: 25,
    };
    expect(reanchoredCommentQuote(first, page, edited)).toBeNull();
    expect(reanchoredCommentQuote(second, page, edited)).toEqual({
      ...second,
      quotedText: "Thursday",
    });
  });

  it("finds the comment's copy past Markdown syntax and list markers", () => {
    const emphasized = "**A**FridayB\n\nAFridayB\n";
    const first = {
      quotedText: "Friday",
      prefix: "A",
      suffix: "BAFridayB",
      startOffset: 1,
    };
    expect(
      reanchoredCommentQuote(first, emphasized, "**A**MondayB\n\nAFridayB\n"),
    ).toEqual({ ...first, quotedText: "Monday" });
    expect(
      reanchoredCommentQuote(first, emphasized, "**A**FridayB\n\nAMondayB\n"),
    ).toBeNull();

    const second = {
      quotedText: "Friday",
      prefix: "AFridayBA",
      suffix: "B",
      startOffset: 9,
    };
    expect(
      reanchoredCommentQuote(
        second,
        "1. AFridayB\n2. AFridayB\n",
        "1. AFridayB\n2. AMondayB\n",
      ),
    ).toEqual({ ...second, quotedText: "Monday" });
  });

  it("gives up when two copies of the quote fit equally well", () => {
    const page = "Friday.\n\nFriday.\n";
    expect(
      reanchoredCommentQuote(
        { quotedText: "Friday", prefix: null, suffix: ".", startOffset: null },
        page,
        "Friday.\n\nThursday.\n",
      ),
    ).toBeNull();
  });

  it("quotes the edited text without the formatting it adds", () => {
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace("Friday afternoon", "**Thursday** at noon"),
      ),
    ).toEqual({ ...quote, quotedText: "ships every Thursday at noon" });
  });
});
