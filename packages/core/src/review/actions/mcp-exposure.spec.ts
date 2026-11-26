import { describe, expect, it } from "vitest";

import consumeReviewFeedback from "./consume-review-feedback.js";
import createReviewComment from "./create-review-comment.js";
import getReviewFeedback from "./get-review-feedback.js";
import listReviewComments from "./list-review-comments.js";
import reactToReviewComment from "./react-to-review-comment.js";
import replyReviewComment from "./reply-review-comment.js";
import resolveReviewThread from "./resolve-review-thread.js";
import sendReviewThreadToAgent from "./send-review-thread-to-agent.js";
import setReviewStatus from "./set-review-status.js";
import setReviewThreadMuted from "./set-review-thread-muted.js";
import setReviewThreadUnread from "./set-review-thread-unread.js";
import setReviewThreadsUnread from "./set-review-threads-unread.js";
import updateReviewCommentAnchor from "./update-review-comment-anchor.js";
import updateReviewComment from "./update-review-comment.js";

describe("review actions over MCP", () => {
  it.each([
    ["create-review-comment", createReviewComment],
    ["list-review-comments", listReviewComments],
    ["react-to-review-comment", reactToReviewComment],
    ["reply-review-comment", replyReviewComment],
    ["resolve-review-thread", resolveReviewThread],
    ["set-review-status", setReviewStatus],
    ["set-review-thread-muted", setReviewThreadMuted],
    ["set-review-thread-unread", setReviewThreadUnread],
    ["set-review-threads-unread", setReviewThreadsUnread],
    ["update-review-comment", updateReviewComment],
    ["update-review-comment-anchor", updateReviewCommentAnchor],
  ] as const)(
    "serves %s to outside agents unlisted, through tool search",
    (_name, action) => {
      expect(action.mcpTool).toBe("search");
    },
  );
  it.each([
    ["consume-review-feedback", consumeReviewFeedback],
    ["get-review-feedback", getReviewFeedback],
    ["send-review-thread-to-agent", sendReviewThreadToAgent],
  ] as const)("keeps %s in the app, off MCP", (_name, action) => {
    expect(action.mcpTool).toBe(false);
  });
});
