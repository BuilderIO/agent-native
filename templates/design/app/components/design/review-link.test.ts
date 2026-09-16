import { describe, expect, it } from "vitest";

import { reviewThreadIdFromHash } from "./review-link";

describe("reviewThreadIdFromHash", () => {
  it("reads encoded comment links and ignores unrelated hashes", () => {
    expect(reviewThreadIdFromHash("#comment=thread%2F1&view=overview")).toBe(
      "thread/1",
    );
    expect(reviewThreadIdFromHash("#selection=node-1")).toBeNull();
  });
});
