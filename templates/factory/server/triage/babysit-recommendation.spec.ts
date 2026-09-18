import { describe, expect, it } from "vitest";

import type { BabysitMechanicalVerdict } from "./babysit-evidence.js";
import { computeBabysitRecommendation } from "./babysit-recommendation.js";
import type { BabysitProposal } from "./pr-babysit.js";

const baseProposal = (): BabysitProposal => ({
  unansweredComments: [],
  unansweredBotComments: [],
  failingChecks: [],
  informationalChecks: [],
  missingChangesetPackages: [],
  pendingChecks: [],
  checksCoverage: "complete",
  commentsTruncated: false,
  reviewsTruncated: false,
  humanReviewBodyKeys: [],
  botReviewBodyKeys: [],
  isClean: true,
});

const baseMechanical = (
  overrides: Partial<BabysitMechanicalVerdict> = {},
): BabysitMechanicalVerdict => ({
  needsWork: false,
  isClean: true,
  mergeability: { mergeConflict: false, mergeabilityComputed: true },
  newHumanWork: false,
  newBotWork: false,
  newDefiniteMergeConflict: false,
  builderActive: false,
  builderActiveUntil: null,
  headShaChangedSinceLastPing: false,
  ping: { allowed: false, reason: "already-asked" },
  ...overrides,
});

describe("computeBabysitRecommendation", () => {
  it("recommends defer while Builder is active", () => {
    const result = computeBabysitRecommendation({
      proposal: baseProposal(),
      mechanical: baseMechanical({ builderActive: true, needsWork: true }),
      checks: [{ name: "ci", state: "in_progress", observedAt: "2026-01-01" }],
      comments: [],
      lastCommentAtMs: Date.now() - 60_000,
      lastPingHeadSha: "abc",
      headSha: "abc",
      nowMs: Date.now(),
    });
    expect(result.recommendation).toBe("defer");
    expect(result.builderActive).toBe(true);
  });

  it("recommends ping when open bot threads remain", () => {
    const result = computeBabysitRecommendation({
      proposal: {
        ...baseProposal(),
        isClean: false,
        unansweredBotComments: [
          {
            id: "1",
            author: "builder-io-integration[bot]",
            inReplyToId: null,
            body: "fix this",
            createdAt: "2026-01-01",
          },
        ],
      },
      mechanical: baseMechanical({
        needsWork: true,
        ping: { allowed: true, reason: "new-bot-work" },
      }),
      checks: [{ name: "ci", state: "passed", observedAt: "2026-01-01" }],
      comments: [],
      lastCommentAtMs: null,
      lastPingHeadSha: null,
      headSha: "abc",
      nowMs: Date.now(),
    });
    expect(result.recommendation).toBe("ping");
    expect(result.because).toMatch(/bot thread/i);
  });

  it("does not defer from Factory's ping timestamp when CI is idle", () => {
    const result = computeBabysitRecommendation({
      proposal: baseProposal(),
      mechanical: baseMechanical({ needsWork: true }),
      checks: [{ name: "ci", state: "passed", observedAt: "2026-01-01" }],
      comments: [],
      lastCommentAtMs: Date.now() - 60_000,
      lastPingHeadSha: "abc",
      headSha: "abc",
      nowMs: Date.now(),
    });
    expect(result.recommendation).not.toBe("defer");
    expect(result.builderActive).toBe(false);
  });

  it("recommends stuck after bot error replies in issue comments", () => {
    const now = Date.now();
    const result = computeBabysitRecommendation({
      proposal: baseProposal(),
      mechanical: baseMechanical({ needsWork: true }),
      checks: [],
      comments: [],
      issueComments: [
        {
          author: "builder-io-integration[bot]",
          body: "Request failed with error",
          createdAt: new Date(now).toISOString(),
        },
      ],
      lastCommentAtMs: now - 120_000,
      lastPingHeadSha: "abc",
      headSha: "abc",
      nowMs: now,
    });
    expect(result.recommendation).toBe("stuck");
  });

  it("recommends stuck when only pre-ping resolved threads would veto bot errors", () => {
    const now = Date.now();
    const pingAt = now - 120_000;
    const result = computeBabysitRecommendation({
      proposal: baseProposal(),
      mechanical: baseMechanical({ needsWork: true }),
      checks: [],
      comments: [
        {
          id: "root-1",
          author: "builder-io-integration[bot]",
          inReplyToId: null,
          body: "#### review finding",
          createdAt: "2026-01-01T00:00:00.000Z",
          isResolved: true,
        },
      ],
      issueComments: [
        {
          author: "builder-io-integration[bot]",
          body: "There was a problem with your request, please try again later. Error id: 123",
          createdAt: new Date(now).toISOString(),
        },
      ],
      lastCommentAtMs: pingAt,
      lastPingHeadSha: "abc",
      headSha: "abc",
      nowMs: now,
    });
    expect(result.recommendation).toBe("stuck");
    expect(result.botErrorAfterPing).toBe(true);
  });

  it("defers instead of stuck when Builder replied on review threads after the ping", () => {
    const now = Date.now();
    const pingAt = now - 120_000;
    const result = computeBabysitRecommendation({
      proposal: {
        ...baseProposal(),
        isClean: false,
        unansweredBotComments: [],
      },
      mechanical: baseMechanical({
        needsWork: true,
        builderActive: true,
        builderActiveUntil: new Date(now + 1_800_000).toISOString(),
      }),
      checks: [{ name: "ci", state: "in_progress", observedAt: "2026-01-01" }],
      comments: [
        {
          id: "root-1",
          author: "builder-io-integration",
          inReplyToId: null,
          body: "#### review finding",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "reply-1",
          author: "builder-io-integration",
          inReplyToId: "root-1",
          body: "Fixed in abc123 — agreed, this was a real inconsistency.",
          createdAt: new Date(now).toISOString(),
        },
      ],
      issueComments: [
        {
          author: "steve8708",
          body: "@builderio-bot look at the latest PR feedback",
          createdAt: new Date(pingAt).toISOString(),
        },
        {
          author: "builder-io-integration[bot]",
          body: "There was a problem with your request, please try again later. Error id: 123",
          createdAt: new Date(now).toISOString(),
        },
      ],
      lastCommentAtMs: pingAt,
      lastPingHeadSha: "abc",
      headSha: "def",
      nowMs: now,
    });
    expect(result.recommendation).toBe("defer");
    expect(result.botErrorAfterPing).toBe(false);
  });

  it("recommends stuck when a thread is marked required not fixing", () => {
    const pingAt = Date.parse("2026-09-14T18:02:00.000Z");
    const result = computeBabysitRecommendation({
      proposal: {
        ...baseProposal(),
        unansweredBotComments: [],
        isClean: false,
      },
      mechanical: baseMechanical({ needsWork: true }),
      checks: [],
      comments: [
        {
          id: "1",
          author: "builder-io-integration[bot]",
          inReplyToId: null,
          body: "please fix",
          createdAt: "2026-09-14T18:00:00.000Z",
        },
        {
          id: "2",
          author: "builder-io-bot",
          inReplyToId: "1",
          body: "Required — not fixing: intentional",
          createdAt: "2026-09-14T18:05:00.000Z",
        },
      ],
      issueComments: [],
      lastCommentAtMs: pingAt,
      lastPingHeadSha: "abc",
      headSha: "abc",
      nowMs: pingAt + 60_000,
    });
    expect(result.recommendation).toBe("stuck");
  });

  it("recommends stuck after bot error replies", () => {
    const now = Date.now();
    const result = computeBabysitRecommendation({
      proposal: baseProposal(),
      mechanical: baseMechanical({ needsWork: true }),
      checks: [],
      comments: [
        {
          id: "1",
          author: "builder-io-integration[bot]",
          inReplyToId: null,
          body: "Request failed with error",
          createdAt: new Date(now).toISOString(),
        },
      ],
      lastCommentAtMs: now - 120_000,
      lastPingHeadSha: "abc",
      headSha: "abc",
      nowMs: now,
    });
    expect(result.recommendation).toBe("stuck");
  });
});
