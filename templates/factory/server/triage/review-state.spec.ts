import { describe, expect, it } from "vitest";

import {
  hasTriageSourceChanged,
  statusAfterPullRequestPoll,
  statusAfterTriageSourceUpdate,
} from "./review-state.js";

describe("triage review state", () => {
  it("does not reopen unchanged provider evidence", () => {
    const snapshot = {
      title: "Issue",
      summary: "A bug",
      sourceUrl: "https://example.com/item",
      lastSeenAt: "2026-08-12T12:00:00.000Z",
    };

    expect(hasTriageSourceChanged(snapshot, snapshot)).toBe(false);
    expect(
      statusAfterTriageSourceUpdate("shadow_decided", false, "received"),
    ).toBe("shadow_decided");
  });

  it("reopens an item when the source evidence changes", () => {
    const snapshot = {
      title: "Issue",
      summary: "A bug",
      lastSeenAt: "2026-08-12T12:00:00.000Z",
    };

    expect(
      hasTriageSourceChanged(snapshot, {
        ...snapshot,
        lastSeenAt: "2026-08-12T13:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      statusAfterTriageSourceUpdate("needs_manual", true, "received"),
    ).toBe("received");
  });

  it("keeps an out-of-scope babysit skip out of the review window", () => {
    expect(
      statusAfterPullRequestPoll({
        existingStatus: "needs_manual",
        existingAuthor: "steve8708",
        nextAuthor: "steve8708",
        existingBabysitState: "out-of-scope",
        nextDraft: false,
        sourceChanged: true,
      }),
    ).toBe("needs_manual");
  });

  it("reopens a skipped pull request when the author changes", () => {
    expect(
      statusAfterPullRequestPoll({
        existingStatus: "needs_manual",
        existingAuthor: "steve8708",
        nextAuthor: "builder-io-bot",
        existingBabysitState: "out-of-scope",
        nextDraft: false,
        sourceChanged: true,
      }),
    ).toBe("pr_observed");
  });

  it("reopens a closed-or-draft skip once the pull request is open", () => {
    expect(
      statusAfterPullRequestPoll({
        existingStatus: "needs_manual",
        existingAuthor: "builder-io-bot",
        nextAuthor: "builder-io-bot",
        existingBabysitState: "closed-or-draft",
        nextDraft: false,
        sourceChanged: false,
      }),
    ).toBe("pr_observed");
  });

  it("keeps a stuck babysit decision on needs_manual across polls", () => {
    expect(
      statusAfterPullRequestPoll({
        existingStatus: "needs_manual",
        existingAuthor: "builder-io-bot",
        nextAuthor: "builder-io-bot",
        existingBabysitState: "stuck",
        nextDraft: false,
        sourceChanged: true,
      }),
    ).toBe("needs_manual");
  });

  // A human comment moves neither the head SHA nor the title, so without the
  // reopen flag a stuck item would keep needs_manual and never be looked at again.
  it("returns a reopened babysit item to the review status without a source change", () => {
    expect(
      statusAfterPullRequestPoll({
        existingStatus: "needs_manual",
        existingAuthor: "builder-io-bot",
        nextAuthor: "builder-io-bot",
        existingBabysitState: "stuck",
        babysitReopened: true,
        nextDraft: false,
        sourceChanged: false,
      }),
    ).toBe("pr_observed");
  });
});
