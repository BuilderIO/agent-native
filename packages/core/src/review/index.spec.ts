import { describe, expect, it } from "vitest";

import {
  insertReviewCommentIdempotently,
  insertReviewReplyIdempotently,
  resolveReviewThread,
} from "./index.js";

describe("review public sync exports", () => {
  it("exposes the idempotent comment and thread operations", () => {
    expect(insertReviewCommentIdempotently).toBeTypeOf("function");
    expect(insertReviewReplyIdempotently).toBeTypeOf("function");
    expect(resolveReviewThread).toBeTypeOf("function");
  });
});
