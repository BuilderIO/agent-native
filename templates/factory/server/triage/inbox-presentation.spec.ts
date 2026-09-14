import { describe, expect, it } from "vitest";

import { deriveInboxPresentation } from "./inbox-presentation.js";
import { babysitLeavesReviewWindow } from "./pr-babysit.js";
import { slackFeedbackLeavesReviewWindow } from "./slack-review-window.js";

function presentation(
  source: string,
  status: string,
  metadata: Record<string, unknown> = {},
) {
  return deriveInboxPresentation({
    source,
    status,
    metadataJson: JSON.stringify(metadata),
  });
}

describe("deriveInboxPresentation leavesReviewWindow parity", () => {
  it("matches babysitLeavesReviewWindow for every documented babysit state", () => {
    for (const state of ["waiting", "quiet", "clean", "stuck", "defer"]) {
      expect(
        presentation("github", "pr_observed", { prBabysitState: state })
          .leavesReviewWindow,
      ).toBe(babysitLeavesReviewWindow(state));
    }
    for (const state of [
      "active",
      "queued",
      "out-of-scope",
      "closed-or-draft",
      null,
      undefined,
    ]) {
      const metadata = state == null ? {} : { prBabysitState: state as string };
      expect(
        presentation("github", "pr_observed", metadata).leavesReviewWindow,
      ).toBe(babysitLeavesReviewWindow(state));
    }
  });

  it("matches slackFeedbackLeavesReviewWindow for every documented Slack case", () => {
    const cases: Array<{
      status: string;
      metadata?: Record<string, unknown>;
    }> = [
      { status: "automation_started" },
      { status: "evidence_ready" },
      { status: "received", metadata: { slackReactionName: "eyes" } },
      { status: "received" },
      { status: "needs_manual" },
      { status: "received", metadata: { slackReactionName: "robot_face" } },
    ];
    for (const entry of cases) {
      const reaction = entry.metadata?.slackReactionName as string | undefined;
      expect(
        presentation("slack", entry.status, entry.metadata ?? {})
          .leavesReviewWindow,
      ).toBe(
        slackFeedbackLeavesReviewWindow({
          status: entry.status,
          slackReactionName: reaction,
        }),
      );
    }
  });

  it("never parks non-github non-slack sources", () => {
    expect(presentation("sentry", "received").leavesReviewWindow).toBe(false);
    expect(presentation("github_issue", "received").leavesReviewWindow).toBe(
      false,
    );
  });
});

describe("deriveInboxPresentation automation display", () => {
  it("returns null automation for GitHub without babysit state", () => {
    expect(presentation("github", "pr_observed").automation).toBeNull();
  });

  it("maps queued babysit state to babysit.queued", () => {
    expect(
      presentation("github", "pr_observed", { prBabysitState: "queued" })
        .automation?.key,
    ).toBe("babysit.queued");
  });

  it("maps out-of-scope to ineligible without parking", () => {
    const result = presentation("github", "pr_observed", {
      prBabysitState: "out-of-scope",
    });
    expect(result.automation?.key).toBe("babysit.ineligible");
    expect(result.leavesReviewWindow).toBe(false);
  });

  it("adds reopened hint when poll re-queued a parked PR", () => {
    expect(
      presentation("github", "pr_observed", {
        prBabysitState: "queued",
        prBabysitPendingReopen: true,
      }).automation?.hintKey,
    ).toBe("triage.inboxPhase.babysit.reopened");
  });

  it("maps eyes reaction to claimed and parks Slack items", () => {
    const result = presentation("slack", "received", {
      slackReactionName: "eyes",
    });
    expect(result.automation?.key).toBe("slack.claimed");
    expect(result.leavesReviewWindow).toBe(true);
  });

  it("does not treat robot_face as claimed", () => {
    const result = presentation("slack", "received", {
      slackReactionName: "robot_face",
    });
    expect(result.automation?.key).toBe("slack.new");
    expect(result.leavesReviewWindow).toBe(false);
  });
});

describe("deriveInboxPresentation routing", () => {
  it("maps routing to inboxRouting label keys", () => {
    expect(presentation("github", "pr_observed").routing.labelKey).toBe(
      "triage.inboxRouting.pr_observed",
    );
    expect(presentation("slack", "needs_manual").routing.tone).toBe("warning");
  });
});
