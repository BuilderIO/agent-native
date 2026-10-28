import { describe, expect, it } from "vitest";

import {
  babysitLeavesReviewWindow,
  commentBodyLooksLikeBotFailureAfterPing,
  deferBabysitQuietWindowExpired,
  detectBotErrorAfterPing,
  stripCodeContextForBotErrorScan,
  hasCompletePassingChecks,
  hasMergeConflict,
  hasNewDefiniteMergeConflict,
  mergeabilityComputed,
  reconcileBabysitState,
  resolveStickyMergeability,
  countHumanReviewBodies,
  countHumanReviewComments,
  hasHumanChangesRequested,
  shouldReopenParkedBabysit,
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
  it("requires complete, non-empty, all-passed check evidence", () => {
    expect(
      hasCompletePassingChecks({ checksCoverage: "complete", checks: [] }),
    ).toBe(false);
    expect(
      hasCompletePassingChecks({
        checksCoverage: "complete",
        checks: [check("pending", "queued")],
      }),
    ).toBe(false);
    expect(
      hasCompletePassingChecks({
        checksCoverage: "complete",
        checks: [check("running", "in_progress")],
      }),
    ).toBe(false);
    expect(
      hasCompletePassingChecks({
        checksCoverage: "complete",
        checks: [check("failed", "failed")],
      }),
    ).toBe(false);
    expect(
      hasCompletePassingChecks({
        checksCoverage: "complete",
        checks: [check("cancelled", "cancelled")],
      }),
    ).toBe(false);
    expect(
      hasCompletePassingChecks({
        checksCoverage: "complete",
        checks: [check("passed", "passed")],
      }),
    ).toBe(true);
  });

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
    expect(complete.reviewsTruncated).toBe(false);
    expect(complete.humanReviewBodyKeys).toEqual([]);
    expect(complete.isClean).toBe(true);
  });

  it("is never clean when a human COMMENTED review has a body", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      reviews: [
        { author: "reviewer", state: "commented", body: "please fix the API" },
      ],
    });
    expect(result.isClean).toBe(false);
    expect(result.humanReviewBodyKeys).toEqual(["reviewer:please fix the API"]);
  });

  it("is never clean when the review page was truncated", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      reviews: [],
      reviewsTruncated: true,
    });
    expect(result.reviewsTruncated).toBe(true);
    expect(result.isClean).toBe(false);
  });
});

describe("babysit work policy", () => {
  it("recognizes merge conflicts", () => {
    expect(
      hasMergeConflict({ mergeable: false, mergeableState: "dirty" }),
    ).toBe(true);
    expect(
      hasMergeConflict({ mergeable: null, mergeableState: "unknown" }),
    ).toBe(false);
  });

  it("parks waiting, quiet, and clean items out of the review window", () => {
    expect(babysitLeavesReviewWindow("waiting")).toBe(true);
    expect(babysitLeavesReviewWindow("quiet")).toBe(true);
    expect(babysitLeavesReviewWindow("clean")).toBe(true);
    expect(babysitLeavesReviewWindow("active")).toBe(false);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: false,
        storedChangesRequested: false,
        nextChangesRequested: false,
        storedCommentsTruncated: false,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: false,
        storedChangesRequested: false,
        nextChangesRequested: false,
        storedCommentsTruncated: false,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: true,
        storedChangesRequested: false,
        nextChangesRequested: false,
        storedCommentsTruncated: false,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: false,
        storedChangesRequested: false,
        nextChangesRequested: true,
        storedCommentsTruncated: false,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: false,
        storedChangesRequested: false,
        nextChangesRequested: false,
        storedCommentsTruncated: true,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 40,
      }),
    ).toBe(false);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: false,
        storedChangesRequested: false,
        nextChangesRequested: false,
        storedCommentsTruncated: true,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 1,
        storedHumanReviewBodyCount: 0,
        nextHumanReviewBodyCount: 1,
        storedReviewsTruncated: false,
        nextReviewsTruncated: false,
      }),
    ).toBe(true);
    expect(
      shouldReopenParkedBabysit({
        parked: true,
        newDefiniteMergeConflict: false,
        storedChangesRequested: false,
        nextChangesRequested: false,
        storedCommentsTruncated: false,
        storedHumanReviewCommentCount: 1,
        nextHumanReviewCommentCount: 1,
        storedHumanReviewBodyCount: 0,
        nextHumanReviewBodyCount: 40,
        storedReviewsTruncated: true,
        nextReviewsTruncated: true,
      }),
    ).toBe(false);
    expect(
      countHumanReviewComments([
        comment({ id: "1", author: "reviewer" }),
        comment({ id: "2", author: "builderio-bot" }),
        comment({ id: "3", author: "author", inReplyToId: "1" }),
      ]),
    ).toBe(1);
    expect(
      countHumanReviewBodies([
        { author: "reviewer", state: "commented", body: "please fix the API" },
        { author: "builderio-bot", state: "commented", body: "looking" },
        { author: "reviewer", state: "pending", body: "draft" },
        { author: "reviewer", state: "approved", body: "LGTM" },
        { author: "reviewer", state: "commented", body: "   " },
      ]),
    ).toBe(1);
    expect(
      hasHumanChangesRequested([
        { author: "builderio-bot", state: "changes_requested" },
        { author: "reviewer", state: "commented" },
      ]),
    ).toBe(false);
    expect(
      hasHumanChangesRequested([
        { author: "reviewer", state: "changes_requested" },
      ]),
    ).toBe(true);
  });

  it("separates uncomputed mergeability from a definite reading", () => {
    expect(
      mergeabilityComputed({ mergeable: null, mergeableState: "unknown" }),
    ).toBe(false);
    expect(
      mergeabilityComputed({ mergeable: null, mergeableState: "dirty" }),
    ).toBe(false);
    expect(
      mergeabilityComputed({ mergeable: true, mergeableState: "unknown" }),
    ).toBe(false);
    for (const state of [
      "clean",
      "unstable",
      "blocked",
      "behind",
      "has_hooks",
    ]) {
      expect(
        mergeabilityComputed({ mergeable: true, mergeableState: state }),
      ).toBe(true);
    }
    expect(
      mergeabilityComputed({ mergeable: false, mergeableState: "dirty" }),
    ).toBe(true);
  });

  it("holds the last definite mergeability instead of storing uncomputed as clean", () => {
    expect(
      resolveStickyMergeability(
        { mergeConflict: true, mergeabilityComputed: true },
        { mergeable: null, mergeableState: "unknown" },
      ),
    ).toEqual({ mergeConflict: true, mergeabilityComputed: true });
    expect(
      resolveStickyMergeability(
        { mergeConflict: true, mergeabilityComputed: true },
        { mergeable: true, mergeableState: "clean" },
      ),
    ).toEqual({ mergeConflict: false, mergeabilityComputed: true });
    expect(
      resolveStickyMergeability(
        { mergeConflict: undefined, mergeabilityComputed: undefined },
        { mergeable: null, mergeableState: "unknown" },
      ),
    ).toEqual({ mergeConflict: false, mergeabilityComputed: false });
  });

  it("counts a first computation as adoption, not a new conflict", () => {
    const dirty = { mergeable: false, mergeableState: "dirty" };
    expect(
      hasNewDefiniteMergeConflict({
        storedMergeConflict: false,
        storedMergeabilityComputed: false,
        ...dirty,
      }),
    ).toBe(false);
    expect(
      hasNewDefiniteMergeConflict({
        storedMergeConflict: undefined,
        storedMergeabilityComputed: undefined,
        ...dirty,
      }),
    ).toBe(false);
    expect(
      hasNewDefiniteMergeConflict({
        storedMergeConflict: false,
        storedMergeabilityComputed: true,
        ...dirty,
      }),
    ).toBe(true);
    expect(
      hasNewDefiniteMergeConflict({
        storedMergeConflict: true,
        storedMergeabilityComputed: true,
        ...dirty,
      }),
    ).toBe(false);
    expect(
      hasNewDefiniteMergeConflict({
        storedMergeConflict: false,
        storedMergeabilityComputed: true,
        mergeable: null,
        mergeableState: "unknown",
      }),
    ).toBe(false);
  });

  it("treats outdated bot threads as clean when no other work remains", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({
          id: "bot1",
          author: "builder-io-integration[bot]",
          body: "please fix",
          isOutdated: true,
        }),
      ],
      botAuthors: ["builder-io-integration[bot]"],
    });
    expect(result.unansweredBotComments).toHaveLength(0);
    expect(result.isClean).toBe(true);
  });

  it("treats unresolved bot review threads as not clean", () => {
    const result = reconcileBabysitState({
      ...baseInput,
      comments: [
        comment({
          id: "bot1",
          author: "builder-io-integration[bot]",
          body: "please fix",
        }),
      ],
      botAuthors: ["builder-io-integration[bot]"],
    });
    expect(result.unansweredBotComments).toHaveLength(1);
    expect(result.isClean).toBe(false);
  });

  it("keeps quiet rows parked and takes stuck out of the review window", () => {
    for (const state of ["waiting", "quiet", "clean", "stuck", "defer"]) {
      expect(babysitLeavesReviewWindow(state)).toBe(true);
    }
    for (const state of ["active", "queued", "out-of-scope", null, undefined]) {
      expect(babysitLeavesReviewWindow(state)).toBe(false);
    }
  });

  it("detects bot errors in issue comments after Factory's ping", () => {
    const pingAt = Date.parse("2026-08-11T15:23:49.000Z");
    expect(
      detectBotErrorAfterPing({
        comments: [],
        issueComments: [
          {
            author: "builder-io-integration[bot]",
            body: "The request failed with an error",
            createdAt: "2026-08-11T15:24:00.000Z",
          },
        ],
        lastCommentAtMs: pingAt,
      }),
    ).toBe(true);
  });

  it("detects Builder generic retry banners after Factory's ping", () => {
    const pingAt = Date.parse("2026-08-11T15:23:49.000Z");
    expect(
      detectBotErrorAfterPing({
        comments: [],
        issueComments: [
          {
            author: "builder-io-integration[bot]",
            body: "There was a problem with your request, please try again later. Error id: 123",
            createdAt: "2026-08-11T15:24:00.000Z",
          },
        ],
        lastCommentAtMs: pingAt,
      }),
    ).toBe(true);
  });

  it("ignores technical error prose in Builder disposition replies", () => {
    const pingAt = Date.parse("2026-09-14T22:31:32.208Z");
    expect(
      detectBotErrorAfterPing({
        comments: [
          {
            id: "root-1",
            author: "builder-io-integration",
            inReplyToId: null,
            body: "#### review finding",
            createdAt: "2026-09-14T21:41:53.000Z",
          },
          {
            id: "reply-1",
            author: "builder-io-integration",
            inReplyToId: "root-1",
            body: "Not fixed — acknowledged and deliberate.\n\nDynamic error text passing through unlocalised is also the existing behaviour of this module for provider payload messages.",
            createdAt: "2026-09-14T22:41:35.000Z",
          },
        ],
        lastCommentAtMs: pingAt,
      }),
    ).toBe(false);
  });

  it("ignores dotted error identifiers inside inline code", () => {
    expect(
      commentBodyLooksLikeBotFailureAfterPing(
        "`gateway-error-lane-parity.spec.ts` asserts exactly this for the 402 credits limit case (`expect(credits.stop.error).toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE)`).",
      ),
    ).toBe(false);
    expect(
      stripCodeContextForBotErrorScan("an error path, and centralising"),
    ).toBe("an error path, and centralising");
    expect(
      commentBodyLooksLikeBotFailureAfterPing(
        "an error path, and centralising",
      ),
    ).toBe(false);
  });

  it("reopens defer after the builder quiet window expires", () => {
    expect(
      deferBabysitQuietWindowExpired(
        {
          prBabysitState: "defer",
          prBabysitBuilderActiveUntil: "2026-09-11T12:00:00.000Z",
        },
        Date.parse("2026-09-11T12:00:01.000Z"),
      ),
    ).toBe(true);
    expect(
      deferBabysitQuietWindowExpired(
        {
          prBabysitState: "defer",
          prBabysitBuilderActiveUntil: "2026-09-11T12:00:00.000Z",
        },
        Date.parse("2026-09-11T11:59:59.000Z"),
      ),
    ).toBe(false);
    expect(
      deferBabysitQuietWindowExpired(
        { prBabysitState: "waiting" },
        Date.parse("2026-09-11T12:00:01.000Z"),
      ),
    ).toBe(false);
  });

  it("reopens stuck for human review but not for a merge conflict", () => {
    const base = {
      parked: true,
      parkedState: "stuck",
      newDefiniteMergeConflict: true,
      storedChangesRequested: false,
      nextChangesRequested: false,
      storedCommentsTruncated: false,
      storedHumanReviewCommentCount: 1,
      nextHumanReviewCommentCount: 1,
    };
    expect(shouldReopenParkedBabysit(base)).toBe(false);
    expect(shouldReopenParkedBabysit({ ...base, parkedState: "waiting" })).toBe(
      true,
    );
    expect(
      shouldReopenParkedBabysit({ ...base, nextChangesRequested: true }),
    ).toBe(true);
    expect(
      shouldReopenParkedBabysit({ ...base, nextHumanReviewCommentCount: 2 }),
    ).toBe(true);
  });
});
