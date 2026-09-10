import { describe, expect, it } from "vitest";

import {
  dispatchSkipPreservesItemStatus,
  dispatchSkipStatusWrite,
  isClaimedSlackReactionName,
  slackFeedbackLeavesReviewWindow,
} from "./slack-review-window.js";

describe("slack review window", () => {
  it("treats eyes and robot_face as claimed Slack markers", () => {
    expect(isClaimedSlackReactionName("eyes")).toBe(true);
    expect(isClaimedSlackReactionName(" robot_face ")).toBe(true);
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
        slackReactionName: "robot_face",
      }),
    ).toBe(true);
    expect(slackFeedbackLeavesReviewWindow({ status: "received" })).toBe(false);
  });

  it("does not rewrite started items to needs_manual on a skip", () => {
    expect(dispatchSkipPreservesItemStatus("automation_started")).toBe(true);
    expect(dispatchSkipStatusWrite("automation_started")).toEqual({
      nextStatus: null,
      needsManual: false,
      statusPreserved: true,
    });
    expect(dispatchSkipStatusWrite("received")).toEqual({
      nextStatus: "needs_manual",
      needsManual: true,
      statusPreserved: false,
    });
  });
});
