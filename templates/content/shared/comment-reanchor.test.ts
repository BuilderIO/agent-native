import { describe, expect, it } from "vitest";

import {
  commentAnchorHoldsOn,
  commentAnchorText,
  commentQuoteFollower,
  rebaselinedCommentQuote,
  reanchoredCommentQuote,
  type CommentQuoteAnchor,
} from "./comment-reanchor";

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

describe("rebaselinedCommentQuote", () => {
  const anchorOn = (text: string, quotedText: string) => {
    const at = text.indexOf(quotedText);
    return {
      quotedText,
      prefix: text.slice(Math.max(0, at - 32), at),
      suffix: text.slice(at + quotedText.length, at + quotedText.length + 32),
      startOffset: at,
    };
  };

  it("leaves a quote alone when the page shows the same text", () => {
    const text = commentAnchorText("Keep this.\n\n\nThen the rest.");
    expect(
      rebaselinedCommentQuote(
        anchorOn(text, "the rest"),
        text,
        commentAnchorText("Keep this.\nThen the rest."),
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it("follows formatting syntax that becomes formatting", () => {
    const previous = "Keep __bold words__ here. Then the rest.";
    const next = "Keep bold words here. Then the rest.";
    expect(
      rebaselinedCommentQuote(
        anchorOn(previous, "__bold words__ here"),
        previous,
        next,
      ),
    ).toEqual({
      kind: "rebased",
      quote: anchorOn(next, "bold words here"),
    });
  });

  it("moves a quote's offset and context past a change before it", () => {
    const previous = "A __b__ c. The quoted words sit here.";
    const next = "A b c. The quoted words sit here.";
    expect(
      rebaselinedCommentQuote(
        anchorOn(previous, "quoted words"),
        previous,
        next,
      ),
    ).toEqual({ kind: "rebased", quote: anchorOn(next, "quoted words") });
  });

  it("refuses to claim different words as the same quote", () => {
    const previous = "The cat sat on the mat.";
    const next = "The dog sat on the mat.";
    expect(
      rebaselinedCommentQuote(anchorOn(previous, "cat sat"), previous, next),
    ).toEqual({ kind: "blocked" });
  });

  it("reports a quote that was already gone as orphaned", () => {
    expect(
      rebaselinedCommentQuote(
        {
          quotedText: "long gone",
          prefix: "",
          suffix: "",
          startOffset: 0,
        },
        "Some __text__ here.",
        "Some text here.",
      ),
    ).toEqual({ kind: "orphaned" });
  });
});

describe("commentQuoteFollower", () => {
  const text = "Keep the plan here. Move the plan there.";
  // The comment is on the second "the plan".
  const second = {
    quotedText: "the plan",
    prefix: "Keep the plan here. Move ",
    suffix: " there.",
    startOffset: 25,
  };

  it("moves the context and offset past text typed before the quote", () => {
    const next = `Intro. ${text}`;
    expect(commentQuoteFollower(text, next)(second)).toEqual({
      kind: "moved",
      quote: {
        quotedText: "the plan",
        prefix: "Intro. Keep the plan here. Move ",
        suffix: " there.",
        startOffset: 32,
      },
    });
  });

  it("keeps text typed just after or just before the quote outside it", () => {
    const after = text.replace("plan there", "plans there");
    expect(commentQuoteFollower(text, after)(second)).toMatchObject({
      kind: "moved",
      quote: { quotedText: "the plan", suffix: "s there.", startOffset: 25 },
    });
    const before = text.replace("Move the", "Move all the");
    expect(commentQuoteFollower(text, before)(second)).toMatchObject({
      kind: "moved",
      quote: { quotedText: "the plan", startOffset: 29 },
    });
  });

  it("leaves the stored anchor when the edit changes the quote's own text", () => {
    const next = text.replace("Move the plan", "Move the new plan");
    expect(commentQuoteFollower(text, next)(second)).toEqual({ kind: "left" });
  });

  it("stays on its own copy of a repeated quote through edits around both", () => {
    // Each step is one commit. Afterwards the first copy's context reads like
    // the second's original context, which the stored anchor would have kept.
    const steps = [
      text,
      "Keep the plan here. Shift the plan there.",
      "Move the plan there. Shift the plan there.",
    ];
    let anchor: CommentQuoteAnchor = second;
    for (const [index, next] of steps.slice(1).entries()) {
      const outcome = commentQuoteFollower(steps[index]!, next)(anchor);
      if (outcome.kind !== "moved") throw new Error(JSON.stringify(outcome));
      anchor = outcome.quote;
    }
    expect(anchor.startOffset).toBe(steps[2]!.lastIndexOf("the plan"));
    // The original anchor, never followed, now resolves to the first copy.
    expect(
      commentQuoteFollower(steps[2]!, `${steps[2]} `)(second),
    ).toMatchObject({
      quote: { startOffset: steps[2]!.indexOf("the plan") },
    });
  });

  it("leaves a page that didn't change alone", () => {
    expect(commentQuoteFollower(text, text)(second)).toEqual({
      kind: "unchanged",
    });
  });
});

describe("commentAnchorHoldsOn", () => {
  const text = "Keep the plan here. Move the plan there.";
  const second = {
    quotedText: "the plan",
    prefix: "Keep the plan here. Move ",
    suffix: " there.",
    startOffset: 25,
  };

  it("holds where the quote and its context sit at its offset", () => {
    expect(commentAnchorHoldsOn(second, text)).toBe(true);
  });

  it("doesn't hold once the text around the offset changed", () => {
    expect(commentAnchorHoldsOn(second, `Intro. ${text}`)).toBe(false);
    expect(commentAnchorHoldsOn(second, text.replace("Move", "Shift"))).toBe(
      false,
    );
    expect(commentAnchorHoldsOn({ ...second, startOffset: null }, text)).toBe(
      false,
    );
  });
});
