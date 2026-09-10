import { describe, expect, it, vi } from "vitest";

import {
  babysitMechanicalVerdict,
  readBabysitEvidence,
  readBabysitStoredState,
} from "./babysit-evidence.js";
import type { BabysitEvidenceClient } from "./babysit-evidence.js";
import {
  DEFAULT_BABYSIT_PR_COMMENT,
  reconcileBabysitState,
} from "./pr-babysit.js";

const repository = { owner: "builder", repo: "factory" };

function summary(overrides: Record<string, unknown> = {}) {
  return {
    number: 4495,
    title: "Fix the thing",
    body: null,
    htmlUrl: "https://github.com/builder/factory/pull/4495",
    userLogin: "builder-io-bot",
    userId: 1,
    state: "open",
    draft: false,
    headSha: "sha-1",
    headRef: "feature",
    baseRef: "main",
    createdAt: "2026-08-11T15:00:00.000Z",
    updatedAt: "2026-08-11T15:23:00.000Z",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    mergeable: null as boolean | null,
    mergeableState: "unknown" as string | null,
    reviewComments: 0,
    ...overrides,
  };
}

function client(overrides: Partial<BabysitEvidenceClient> = {}) {
  return {
    getPullRequestSummary: vi.fn(async () => summary()),
    getPullRequestEvidence: vi.fn(async () => ({
      comments: [],
      commentsTruncated: false,
      reviews: [],
      reviewsTruncated: false,
      checks: [
        {
          name: "ci",
          state: "failed" as const,
          observedAt: "2026-08-11T15:23:00.000Z",
        },
      ],
      checksCoverage: "complete" as const,
    })),
    listIssueComments: vi.fn(async () => ({
      comments: [],
      truncated: false,
    })),
    ...overrides,
  } as unknown as BabysitEvidenceClient;
}

describe("readBabysitEvidence", () => {
  it("stops at the summary for a closed pull request", async () => {
    const github = client({
      getPullRequestSummary: vi.fn(async () => summary({ state: "closed" })),
    });

    const read = await readBabysitEvidence(github, repository, 4495);

    expect(read.open).toBe(false);
    expect(github.getPullRequestEvidence).not.toHaveBeenCalled();
    expect(github.listIssueComments).not.toHaveBeenCalled();
  });

  it("counts Factory's own request and carries the scan truncation forward", async () => {
    const github = client({
      listIssueComments: vi.fn(async () => ({
        comments: [
          {
            id: "1",
            author: "reviewer",
            body: "looks off",
            createdAt: "",
            htmlUrl: "",
          },
          {
            id: "2",
            author: "builderio-bot",
            body: DEFAULT_BABYSIT_PR_COMMENT,
            createdAt: "",
            htmlUrl: "",
          },
        ],
        truncated: true,
      })),
    });

    const read = await readBabysitEvidence(github, repository, 4495);

    expect(read.open).toBe(true);
    if (!read.open) return;
    expect(read.details.babysitCommentCount).toBe(1);
    expect(read.details.babysitCommentScanTruncated).toBe(true);
  });
});

describe("readBabysitStoredState", () => {
  it("reads absent fields as absent rather than as false readings", () => {
    const stored = readBabysitStoredState({});

    expect(stored.mergeConflict).toBeUndefined();
    expect(stored.mergeabilityComputed).toBeUndefined();
    expect(stored.humanReviewCommentCount).toBeUndefined();
    expect(stored.lastCommentAtMs).toBeNull();
  });

  it("parses the last comment timestamp into a comparable value", () => {
    const stored = readBabysitStoredState({
      prBabysitState: "waiting",
      prBabysitLastCommentAt: "2026-08-11T15:23:49.000Z",
      prBabysitMergeConflict: true,
      prBabysitMergeabilityComputed: true,
      prBabysitHumanReviewCommentCount: 2,
    });

    expect(stored.babysitState).toBe("waiting");
    expect(stored.lastCommentAtMs).toBe(Date.parse("2026-08-11T15:23:49.000Z"));
    expect(stored.mergeConflict).toBe(true);
    expect(stored.humanReviewCommentCount).toBe(2);
  });

  it("does not treat an unparsable timestamp as never asked", () => {
    expect(
      readBabysitStoredState({ prBabysitLastCommentAt: "not-a-date" })
        .lastCommentAtMs,
    ).toBeNull();
  });
});

describe("babysitMechanicalVerdict", () => {
  const details = {
    comments: [],
    commentsTruncated: false,
    reviews: [],
    reviewsTruncated: false,
    checks: [
      {
        name: "ci",
        state: "failed" as const,
        observedAt: "2026-08-11T15:23:00.000Z",
      },
    ],
    checksCoverage: "complete" as const,
    babysitCommentCount: 0,
    babysitCommentScanTruncated: false,
  };
  const proposal = reconcileBabysitState({
    comments: details.comments,
    checks: details.checks,
    checksCoverage: details.checksCoverage,
  });
  const verdict = (
    stored: Parameters<typeof readBabysitStoredState>[0],
    overrides: Partial<typeof details> = {},
    live: { mergeable: boolean | null; mergeableState: string | null } = {
      mergeable: null,
      mergeableState: "unknown",
    },
  ) =>
    babysitMechanicalVerdict({
      stored: readBabysitStoredState(stored),
      summary: live,
      details: { ...details, ...overrides },
      proposal,
      nextHumanReviewCommentCount: 0,
      nextHumanReviewBodyCount: 0,
      nextChangesRequested: false,
      nowMs: Date.parse("2026-08-11T15:25:33.000Z"),
    });

  it("allows the first ask on a pull request with failing CI", () => {
    const result = verdict({});

    expect(result.needsWork).toBe(true);
    expect(result.mergeability.mergeabilityComputed).toBe(false);
    expect(result.ping).toEqual({ allowed: true, reason: "first-ask" });
  });

  it("treats a pending reopen as new human work when poll deferred counter advancement", () => {
    const result = babysitMechanicalVerdict({
      stored: readBabysitStoredState({
        prBabysitState: "queued",
        prBabysitPendingReopen: true,
        prBabysitLastCommentAt: "2026-08-11T15:23:49.000Z",
        prBabysitHumanReviewCommentCount: 1,
      }),
      summary: { mergeable: true, mergeableState: "clean" },
      details: { ...details, babysitCommentCount: 1 },
      proposal,
      nextHumanReviewCommentCount: 2,
      nextHumanReviewBodyCount: 0,
      nextChangesRequested: false,
      nowMs: Date.parse("2026-08-11T15:25:33.000Z"),
    });

    expect(result.newHumanWork).toBe(true);
    expect(result.ping).toEqual({
      allowed: true,
      reason: "new-human-work",
    });
  });

  it("refuses a second ask when GitHub only finished computing mergeability", () => {
    const result = verdict(
      {
        prBabysitState: "waiting",
        prBabysitLastCommentAt: "2026-08-11T15:23:49.000Z",
        prBabysitMergeConflict: false,
        prBabysitMergeabilityComputed: false,
      },
      { babysitCommentCount: 1 },
      { mergeable: false, mergeableState: "dirty" },
    );

    expect(result.newDefiniteMergeConflict).toBe(false);
    expect(result.ping).toEqual({
      allowed: false,
      reason: "duplicate-comment",
    });
  });

  // Parking a still-conflicted branch as clean would end the episode, and the
  // next read would then qualify as a first ask all over again.
  it("keeps a conflicted branch out of clean while mergeability is uncomputed", () => {
    const result = babysitMechanicalVerdict({
      stored: readBabysitStoredState({
        prBabysitState: "waiting",
        prBabysitMergeConflict: true,
        prBabysitMergeabilityComputed: true,
      }),
      summary: { mergeable: null, mergeableState: "unknown" },
      details,
      proposal: reconcileBabysitState({
        comments: [],
        checks: [
          {
            name: "ci",
            state: "passed" as const,
            observedAt: "2026-08-11T15:23:00.000Z",
          },
        ],
        checksCoverage: "complete",
      }),
      nextHumanReviewCommentCount: 0,
      nextHumanReviewBodyCount: 0,
      nextChangesRequested: false,
      nowMs: Date.parse("2026-08-11T15:30:31.000Z"),
    });

    expect(result.isClean).toBe(true);
    expect(result.mergeability.mergeConflict).toBe(true);
    expect(result.needsWork).toBe(true);
  });

  it("refuses any ask it cannot prove is a first ask", () => {
    expect(verdict({}, { babysitCommentScanTruncated: true }).ping).toEqual({
      allowed: false,
      reason: "comment-scan-truncated",
    });
  });
});
