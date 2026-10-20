import { describe, expect, it } from "vitest";

import {
  closedPullRequestKind,
  closedPullRequestTerminalMetadataPatch,
  isTerminalBabysitMetadata,
  pullRequestReopenedFromTerminal,
  reopenedFromTerminalBabysitMetadataPatch,
  readGitHubTerminalFromAuditDetails,
  terminalItemStatusForClosedPullRequest,
} from "./babysit-pr-terminal.js";

describe("closedPullRequestKind", () => {
  it("returns null for open non-draft pull requests", () => {
    expect(
      closedPullRequestKind({ state: "open", draft: false, merged: false }),
    ).toBeNull();
  });

  it("distinguishes merged, closed, and draft", () => {
    expect(
      closedPullRequestKind({ state: "closed", draft: false, merged: true }),
    ).toBe("merged");
    expect(
      closedPullRequestKind({ state: "closed", draft: false, merged: false }),
    ).toBe("closed");
    expect(
      closedPullRequestKind({ state: "open", draft: true, merged: false }),
    ).toBe("draft");
  });
});

describe("terminal resolution", () => {
  it("maps merged pull requests to merged inbox status", () => {
    expect(terminalItemStatusForClosedPullRequest("merged")).toBe("merged");
    expect(
      closedPullRequestTerminalMetadataPatch(
        "merged",
        "2026-09-15T00:00:00.000Z",
        {
          mergedAt: "2026-09-14T19:47:10Z",
        },
      ),
    ).toEqual({
      prBabysitState: "merged",
      prBabysitLastCheckedAt: "2026-09-15T00:00:00.000Z",
      prBabysitPendingReopen: false,
      prBabysitBuilderActiveUntil: null,
      prBabysitMergedAt: "2026-09-14T19:47:10Z",
    });
  });

  it("clears pending reopen for closed and draft skips", () => {
    expect(
      closedPullRequestTerminalMetadataPatch(
        "closed",
        "2026-09-15T00:00:00.000Z",
      ).prBabysitPendingReopen,
    ).toBe(false);
  });
});

describe("review window helpers", () => {
  it("detects terminal metadata for list guards", () => {
    expect(
      isTerminalBabysitMetadata(
        JSON.stringify({ prBabysitState: "merged" }),
        "merged",
      ),
    ).toBe(true);
    expect(
      isTerminalBabysitMetadata(
        JSON.stringify({ prBabysitState: "closed-or-draft" }),
        "needs_manual",
      ),
    ).toBe(true);
    expect(
      isTerminalBabysitMetadata(
        JSON.stringify({ prBabysitState: "queued" }),
        "pr_observed",
      ),
    ).toBe(false);
  });
});

describe("pullRequestReopenedFromTerminal", () => {
  it("detects open non-draft transitions away from terminal babysit state", () => {
    expect(
      pullRequestReopenedFromTerminal({
        existingBabysitState: "merged",
        nextState: "open",
        nextDraft: false,
      }),
    ).toBe(true);
    expect(
      pullRequestReopenedFromTerminal({
        existingBabysitState: "closed-or-draft",
        nextState: "open",
        nextDraft: false,
      }),
    ).toBe(true);
    expect(
      pullRequestReopenedFromTerminal({
        existingBabysitState: "merged",
        nextState: "closed",
        nextDraft: false,
      }),
    ).toBe(false);
  });

  it("clears terminal-only metadata on reopen", () => {
    expect(reopenedFromTerminalBabysitMetadataPatch()).toEqual({
      prBabysitState: null,
      prBabysitPendingReopen: false,
      prBabysitMergedAt: null,
      prBabysitBuilderActiveUntil: null,
    });
  });
});

describe("readGitHubTerminalFromAuditDetails", () => {
  it("reads merged and closed dispositions from audit details", () => {
    expect(
      readGitHubTerminalFromAuditDetails({
        merged: true,
        state: "closed",
        draft: false,
      }),
    ).toBe("merged");
    expect(
      readGitHubTerminalFromAuditDetails({
        state: "closed",
        draft: false,
      }),
    ).toBe("closed");
  });
});
