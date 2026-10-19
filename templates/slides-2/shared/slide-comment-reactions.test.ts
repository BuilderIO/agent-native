import { describe, expect, it } from "vitest";

import {
  parseSlideCommentReactionBuckets,
  serializeSlideCommentReactionBuckets,
  summarizeSlideCommentReactions,
} from "./slide-comment-reactions";

describe("slide comment reactions", () => {
  it("summarizes counts and marks the current viewer's reactions", () => {
    expect(
      summarizeSlideCommentReactions(
        JSON.stringify({
          "🎉": ["other@example.com", "Viewer@Example.com"],
          "👍": ["someone@example.com"],
          empty: [],
        }),
        "viewer@example.com",
      ),
    ).toEqual([
      { emoji: "🎉", count: 2, reacted: true },
      { emoji: "👍", count: 1, reacted: false },
    ]);
  });

  it("round-trips reaction buckets without changing their membership", () => {
    const buckets = {
      "👍": ["viewer@example.com"],
      "❤️": ["other@example.com"],
    };

    expect(
      parseSlideCommentReactionBuckets(
        serializeSlideCommentReactionBuckets(buckets),
      ),
    ).toEqual(buckets);
  });

  it("fails loudly when stored reaction JSON is malformed", () => {
    expect(() => parseSlideCommentReactionBuckets("not-json")).toThrow();
    expect(() =>
      parseSlideCommentReactionBuckets('{"👍":"viewer@example.com"}'),
    ).toThrow("invalid JSON");
  });
});
