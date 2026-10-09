import { describe, expect, it } from "vitest";

import { reanchoredCommentQuote } from "./comment-reanchor";

const before =
  "Our editor is fast.\n\nThe team ships every Friday afternoon, so feedback lands before the weekend.\n";
const quote = {
  quotedText: "ships every Friday afternoon",
  prefix: "The team ",
  suffix: ", so feedback",
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
      prefix: "The team ",
      suffix: " feedback lands before the weeke",
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
  });

  it("does not invent a quote across Markdown syntax", () => {
    expect(
      reanchoredCommentQuote(
        quote,
        before,
        before.replace("Friday afternoon", "**Thursday** at noon"),
      ),
    ).toBeNull();
  });
});
