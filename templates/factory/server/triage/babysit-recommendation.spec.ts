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
