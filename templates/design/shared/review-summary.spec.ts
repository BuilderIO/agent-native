import { describe, expect, it } from "vitest";

import { readDesignReviewSummary } from "./review-summary";

describe("readDesignReviewSummary", () => {
  it("reads server-computed root-thread counts", () => {
    expect(
      readDesignReviewSummary({
        summary: { openCount: 702, agentQueueCount: 31 },
      }),
    ).toEqual({ openCount: 702, agentQueueCount: 31 });
  });

  it("rejects missing or malformed summaries", () => {
    expect(readDesignReviewSummary(null)).toBeNull();
    expect(
      readDesignReviewSummary({
        summary: { openCount: -1, agentQueueCount: "many" },
      }),
    ).toBeNull();
  });
});
