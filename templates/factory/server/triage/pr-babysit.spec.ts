import { describe, expect, it } from "vitest";

import {
  babysitFingerprint,
  babysitOutOfScopeClause,
  formatBabysitAuditSummary,
  hasMergeConflict,
  reconcileBabysitState,
  shouldRequestBabysitWork,
  type BabysitInput,
  type ReviewCommentObservation,
} from "./pr-babysit.js";

const check = (
  name: string,
  state: "queued" | "in_progress" | "passed" | "failed" | "cancelled",
) => ({ name, state, observedAt: "2026-07-31T10:00:00.000Z" });

const comment = (
  overrides: Partial<ReviewCommentObservation> & { id: string },
): ReviewCommentObservation => ({
  author: "reviewer",
  inReplyToId: null,
  body: "please fix",
  createdAt: "2026-07-31T10:00:00.000Z",
  ...overrides,
});

const baseInput: BabysitInput = {
  comments: [],
  checks: [check("ci", "passed")],
  checksCoverage: "complete",
};

describe("reconcileBabysitState", () => {
  it("treats a comment with no reply as unanswered", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [comment({ id: "c1" })],
    });

    expect(result.unansweredComments).toEqual([comment({ id: "c1" })]);
  });

  it("treats a comment with any reply as answered", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({ id: "c1" }),
        comment({ id: "c2", author: "author", inReplyToId: "c1" }),
      ],
    });

    expect(result.unansweredComments).toEqual([]);
  });

  it("does not let an earlier answered round mask a later unanswered one", () => {
    const commentA = comment({ id: "a" });
    const replyToA = comment({
      id: "a-reply",
      author: "author",
      inReplyToId: "a",
    });
    const commentB = comment({ id: "b" });

    const result = reconcileBabysitState({
      ...baseInput,
      comments: [commentA, replyToA, commentB],
    });

    expect(result.unansweredComments).toEqual([commentB]);
  });

  it("treats a reply as handled even when the provider has not resolved the thread", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({ id: "c1", isResolved: false }),
        comment({ id: "c2", author: "author", inReplyToId: "c1" }),
      ],
    });

    expect(result.unansweredComments).toEqual([]);
  });

  it("treats a resolved thread as answered even with no reply", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [comment({ id: "c1", isResolved: true })],
    });

    expect(result.unansweredComments).toEqual([]);
    expect(result.isClean).toBe(true);
  });

  it("falls back to reply state when isResolved is undefined, never reading it as resolved", () => {
    const unknownWithoutReply = reconcileBabysitState({
      ...baseInput,
      comments: [comment({ id: "c1", isResolved: undefined })],
    });
    expect(unknownWithoutReply.unansweredComments).toEqual([
      comment({ id: "c1" }),
    ]);
    expect(unknownWithoutReply.isClean).toBe(false);

    const unknownWithReply = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({ id: "c1", isResolved: undefined }),
        comment({ id: "c2", author: "author", inReplyToId: "c1" }),
      ],
    });
    expect(unknownWithReply.unansweredComments).toEqual([]);
  });

  it("parses MISSING_CHANGESET_PACKAGES from the failing job log", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      failingJobLog:
        "some log\nMISSING_CHANGESET_PACKAGES: core, , dispatch \nmore log",
    });

    expect(result.missingChangesetPackages).toEqual(["core", "dispatch"]);
  });

  it("returns no missing changeset packages when the log has no such line", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      failingJobLog: "build failed for another reason",
    });

    expect(result.missingChangesetPackages).toEqual([]);
  });

  it("is clean only when comments, failing checks, missing changesets, and pending checks are all empty", () => {
    expect(reconcileBabysitState(baseInput).isClean).toBe(true);

    expect(
      reconcileBabysitState({
        ...baseInput,
        comments: [comment({ id: "c1" })],
      }).isClean,
    ).toBe(false);

    expect(
      reconcileBabysitState({
        ...baseInput,
        checks: [check("test", "failed")],
      }).isClean,
    ).toBe(false);

    expect(
      reconcileBabysitState({
        ...baseInput,
        failingJobLog: "MISSING_CHANGESET_PACKAGES: core",
      }).isClean,
    ).toBe(false);

    expect(
      reconcileBabysitState({
        ...baseInput,
        checks: [check("build", "in_progress")],
      }).isClean,
    ).toBe(false);
  });

  it("classifies failed checks as failing and queued/in_progress checks as pending, not failure", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      checks: [
        check("lint", "failed"),
        check("build", "queued"),
        check("test", "in_progress"),
        check("typecheck", "passed"),
        check("scaffold", "cancelled"),
      ],
    });

    expect(result.failingChecks.map((c) => c.name)).toEqual([
      "lint",
      "scaffold",
    ]);
    expect(result.pendingChecks.map((c) => c.name)).toEqual(["build", "test"]);
    expect(result.isClean).toBe(false);
  });

  it("treats cancelled CI as needing work", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      checks: [check("scaffold", "cancelled")],
    });

    expect(result.failingChecks.map((c) => c.name)).toEqual(["scaffold"]);
    expect(result.isClean).toBe(false);
  });

  it("lets a reply from any author, not just a bot, count as answering", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({ id: "c1", author: "bot" }),
        comment({ id: "c2", author: "human", inReplyToId: "c1" }),
      ],
      botAuthors: ["bot"],
    });

    expect(result.unansweredComments).toEqual([]);
  });

  it("excludes a bot's own top-level comments from the unanswered set", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({ id: "c1", author: "bot" }),
        comment({ id: "c2", author: "human" }),
      ],
      botAuthors: ["bot"],
    });

    expect(result.unansweredComments).toEqual([
      comment({ id: "c2", author: "human" }),
    ]);
  });

  it("is never clean when the comment page was truncated", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [],
      checks: [],
      commentsTruncated: true,
    });

    expect(result.unansweredComments).toEqual([]);
    expect(result.commentsTruncated).toBe(true);
    expect(result.isClean).toBe(false);
  });

  it("is never clean when check evidence is partial", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      checks: [check("CI", "passed")],
      checksCoverage: "partial",
    });

    expect(result.checksCoverage).toBe("partial");
    expect(result.isClean).toBe(false);
  });

  it("requires explicit complete, non-empty check evidence", () => {
    const missingCoverage = reconcileBabysitState({
      comments: [],
      checks: [],
    });
    expect(missingCoverage.checksCoverage).toBe("unknown");
    expect(missingCoverage.isClean).toBe(false);

    const emptyCompleteCoverage = reconcileBabysitState({
      comments: [],
      checks: [],
      checksCoverage: "complete",
    });
    expect(emptyCompleteCoverage.isClean).toBe(false);

    const complete = reconcileBabysitState(baseInput);
    expect(complete.commentsTruncated).toBe(false);
    expect(complete.isClean).toBe(true);
  });
});

describe("babysit work policy", () => {
  const clean = reconcileBabysitState(baseInput);

  it("recognizes merge conflicts", () => {
    expect(
      hasMergeConflict({ mergeable: false, mergeableState: "dirty" }),
    ).toBe(true);
    expect(
      hasMergeConflict({ mergeable: null, mergeableState: "unknown" }),
    ).toBe(false);
  });

  it("requests work for outstanding evidence, not for a clean snapshot", () => {
    expect(
      shouldRequestBabysitWork({
        mergeable: true,
        mergeableState: "clean",
        snapshot: clean,
      }),
    ).toBe(false);
    const failing = reconcileBabysitState({
      ...baseInput,
      checks: [check("ci", "failed")],
    });
    expect(
      shouldRequestBabysitWork({
        mergeable: true,
        mergeableState: "clean",
        snapshot: failing,
      }),
    ).toBe(true);
    expect(
      shouldRequestBabysitWork({
        mergeable: false,
        mergeableState: "dirty",
        snapshot: clean,
      }),
    ).toBe(true);
  });

  it("changes the durable fingerprint when review state changes", () => {
    expect(
      babysitFingerprint({
        headSha: "sha-1",
        mergeable: true,
        mergeableState: "clean",
        snapshot: clean,
        reviewStates: ["commented"],
      }),
    ).not.toBe(
      babysitFingerprint({
        headSha: "sha-1",
        mergeable: true,
        mergeableState: "clean",
        snapshot: clean,
        reviewStates: ["changes_requested"],
      }),
    );
  });

  it("names the pull request and author in the audit sentence", () => {
    expect(
      formatBabysitAuditSummary(3917, babysitOutOfScopeClause("steve8708")),
    ).toBe("#3917 skipped; author steve8708 is out of scope.");
    expect(formatBabysitAuditSummary(null, babysitOutOfScopeClause(null))).toBe(
      "Item skipped; out of scope.",
    );
  });
});
