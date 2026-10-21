import { describe, expect, it } from "vitest";

import {
  isClaimedSlackReactionName,
  slackFeedbackLeavesReviewWindow,
} from "./slack-review-window.js";

describe("slack review window", () => {
  it("treats eyes as the claimed Slack marker", () => {
    expect(isClaimedSlackReactionName("eyes")).toBe(true);
    expect(isClaimedSlackReactionName(" robot_face ")).toBe(false);
    expect(isClaimedSlackReactionName("thumbsup")).toBe(false);
    expect(isClaimedSlackReactionName(undefined)).toBe(false);
  });

  it("keeps started Slack work out of needsReview", () => {
    expect(
      slackFeedbackLeavesReviewWindow({ status: "automation_started" }),
    ).toBe(true);
    expect(slackFeedbackLeavesReviewWindow({ status: "evidence_ready" })).toBe(
      true,
    );
    expect(
      slackFeedbackLeavesReviewWindow({
        status: "received",
        slackReactionName: "eyes",
      }),
    ).toBe(true);
    expect(slackFeedbackLeavesReviewWindow({ status: "received" })).toBe(false);
  });
});
