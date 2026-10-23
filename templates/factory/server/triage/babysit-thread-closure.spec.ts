import { describe, expect, it } from "vitest";

import { assessThreadDispositions } from "./babysit-thread-closure.js";
import type { ReviewCommentObservation } from "./pr-babysit.js";

function root(
  id: string,
  overrides: Partial<ReviewCommentObservation> = {},
): ReviewCommentObservation {
  return {
    id,
    author: "builder-io-integration[bot]",
    inReplyToId: null,
    body: "please fix",
    createdAt: "2026-09-14T18:00:00.000Z",
    ...overrides,
  };
}

describe("assessThreadDispositions", () => {
  it("treats outdated threads as non-blocking", () => {
    const result = assessThreadDispositions({
      comments: [root("1", { isOutdated: true })],
    });
    expect(result.mergeableCondition).toBe(true);
    expect(result.blockingOpenCount).toBe(0);
  });

  it("blocks on required-not-fixing dispositions", () => {
    const result = assessThreadDispositions({
      comments: [
        root("1"),
        {
          id: "2",
          author: "builder-io-bot",
          inReplyToId: "1",
          body: "Required — not fixing: intentional",
          createdAt: "2026-09-14T18:05:00.000Z",
        },
      ],
    });
    expect(result.threads[0]?.status).toBe("disposition-not-fixing");
    expect(result.mergeableCondition).toBe(false);
  });

  it("accepts optional skipping replies", () => {
    const result = assessThreadDispositions({
      comments: [
        root("1"),
        {
          id: "2",
          author: "builder-io-bot",
          inReplyToId: "1",
          body: "Optional — skipping: style only",
          createdAt: "2026-09-14T18:05:00.000Z",
        },
      ],
    });
    expect(result.mergeableCondition).toBe(true);
  });
});
