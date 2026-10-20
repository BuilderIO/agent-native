import { describe, expect, it, vi } from "vitest";

import { GitHubRequestError } from "../triage/github-client.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import type { TripwireSink } from "../tripwire/types.js";
import {
  MERGE_GATE_LIMITS,
  evaluateMergeGate,
  type MergeGateCode,
} from "./factory-merge-gate.js";
import {
  approvedReview,
  fakeGitHub,
  observedAt,
  pullRequestSummary,
} from "./factory-pull-request.fixture.js";
import type { GitHubClient } from "./factory-pull-request.js";

const asClient = (github: ReturnType<typeof fakeGitHub>) =>
  github as unknown as GitHubClient;

function gate(
  github: ReturnType<typeof fakeGitHub>,
  overrides: {
    configuredRepository?: string | null;
    builderAuthorIds?: readonly number[];
    tripwire?: TripwireSink;
  } = {},
) {
  return evaluateMergeGate({
    github: asClient(github),
    repository: { owner: "acme", repo: "app" },
    repositoryLabel: "acme/app",
    number: 7,
    configuredRepository:
      overrides.configuredRepository === undefined
        ? "https://github.com/acme/app"
        : overrides.configuredRepository,
    builderAuthorIds: overrides.builderAuthorIds,
    tripwire: overrides.tripwire,
  });
}

const codes = (result: Awaited<ReturnType<typeof gate>>): MergeGateCode[] =>
  result.reasons.map((reason) => reason.code);

function thread(id: string, resolved: boolean, extra = {}) {
  return {
    id: `${id}-c1`,
    author: "reviewer",
    inReplyToId: null,
    body: "Please rename this.",
    path: "a.ts",
    line: 3,
    createdAt: observedAt,
    isResolved: resolved,
    isOutdated: false,
    threadId: id,
    ...extra,
  };
}

describe("evaluateMergeGate", () => {
  it("clears a Builder pull request with green checks, resolved threads and a small safe diff", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue({
        comments: [thread("t1", true)],
        commentsTruncated: false,
      }),
    });

    const result = await gate(github);

    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.pullRequest).toMatchObject({
      headSha: "head-sha-1",
      authorKind: "builder",
      merged: false,
    });
  });

  it("refuses a repository that is not the factory's before it reads anything", async () => {
    const github = fakeGitHub();

    const other = await gate(github, { configuredRepository: "acme/other" });
    const none = await gate(github, { configuredRepository: null });

    expect(codes(other)).toEqual(["repository_not_allowed"]);
    expect(codes(none)).toEqual(["repository_not_allowed"]);
    expect(other.pullRequest).toBeNull();
    expect(github.getPullRequestSummary).not.toHaveBeenCalled();
  });

  it("refuses a pull request a person opened", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ userLogin: "octocat" })),
    });

    const result = await gate(github);

    expect(codes(result)).toEqual(["author_not_builder"]);
    expect(result.reasons[0]?.message).toContain("octocat");
  });

  it("refuses a pull request whose branch lives in a fork, or in a repository GitHub no longer has", async () => {
    const summaryWith = (overrides: Record<string, unknown>) =>
      fakeGitHub({
        getPullRequestSummary: vi
          .fn()
          .mockResolvedValue(pullRequestSummary(overrides)),
      });

    const fork = await gate(
      summaryWith({ headRepository: "someone-else/app" }),
    );
    const deleted = await gate(summaryWith({ headRepository: null }));
    const renamedCase = await gate(summaryWith({ headRepository: "ACME/App" }));

    expect(codes(fork)).toEqual(["pull_request_from_fork"]);
    expect(fork.reasons[0]?.message).toContain("someone-else/app");
    expect(codes(deleted)).toEqual(["pull_request_from_fork"]);
    expect(deleted.reasons[0]?.message).toContain("no longer has");
    // GitHub names are case-insensitive: the same repository is not a fork.
    expect(codes(renamedCase)).toEqual([]);
  });

  it("refuses a pull request that does not merge into the repository's default branch", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(
          pullRequestSummary({ baseRef: "release", baseDefaultBranch: "main" }),
        ),
    });

    const result = await gate(github);

    expect(codes(result)).toEqual(["base_not_default_branch"]);
    expect(result.reasons[0]?.message).toContain("release");
    expect(result.reasons[0]?.message).toContain("main");
  });

  it("treats exactly builderio-bot and builder-io-integration[bot] as Builder's, in any case, and no lookalike or other babysit name", async () => {
    const author = (userLogin: string) =>
      fakeGitHub({
        getPullRequestSummary: vi
          .fn()
          .mockResolvedValue(pullRequestSummary({ userLogin })),
      });

    for (const login of [
      "builderio-bot",
      "BuilderIO-Bot",
      "builder-io-integration[bot]",
      "Builder-IO-Integration[BOT]",
    ]) {
      const result = await gate(author(login));
      expect(codes(result), login).toEqual([]);
      expect(result.pullRequest?.authorKind).toBe("builder");
    }
    for (const login of [
      "builder-io-bot",
      "builder-io-integration",
      "builder-io-bot[bot]",
      "builderio-bot[bot]",
      "builderio[bot]",
      "builderio-bot2",
      "builderio-botx",
      "xbuilderio-bot",
    ]) {
      const result = await gate(author(login));
      expect(codes(result), login).toEqual(["author_not_builder"]);
      expect(result.eligible).toBe(false);
    }
  });

  it("checks the author's numeric id against the verified list once there is one, and by login alone while there is none", async () => {
    const author = (userLogin: string, userId: number) =>
      fakeGitHub({
        getPullRequestSummary: vi
          .fn()
          .mockResolvedValue(pullRequestSummary({ userLogin, userId })),
      });
    const verified = [4242];

    const match = await gate(author("builderio-bot", 4242), {
      builderAuthorIds: verified,
    });
    const impostor = await gate(author("builderio-bot", 9), {
      builderAuthorIds: verified,
    });
    const person = await gate(author("octocat", 4242), {
      builderAuthorIds: verified,
    });
    const unlisted = await gate(author("builderio-bot", 9));

    expect(codes(match)).toEqual([]);
    expect(codes(impostor)).toEqual(["author_id_mismatch"]);
    expect(impostor.reasons[0]?.message).toContain("9");
    expect(impostor.pullRequest?.authorKind).toBe("human");
    expect(codes(person)).toEqual(["author_not_builder"]);
    expect(codes(unlisted)).toEqual([]);
  });

  it("refuses a closed, merged or draft pull request", async () => {
    const closed = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ state: "closed" })),
    });
    const merged = fakeGitHub({
      getPullRequestSummary: vi.fn().mockResolvedValue(
        pullRequestSummary({
          state: "closed",
          merged: true,
          mergeCommitSha: "merge-sha",
        }),
      ),
    });
    const draft = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ draft: true })),
    });

    expect(codes(await gate(closed))).toEqual(["pull_request_closed"]);
    const mergedResult = await gate(merged);
    expect(codes(mergedResult)).toEqual(["already_merged"]);
    expect(mergedResult.pullRequest).toMatchObject({
      merged: true,
      mergeCommitSha: "merge-sha",
    });
    expect(codes(await gate(draft))).toEqual(["pull_request_draft"]);
  });

  it("refuses until every check on the head commit is green", async () => {
    const failing = fakeGitHub({
      getPullRequestChecks: vi.fn().mockResolvedValue({
        checks: [
          { name: "lint", state: "passed", observedAt },
          { name: "tests", state: "failed", observedAt },
          { name: "build", state: "in_progress", observedAt },
        ],
        checksCoverage: "complete",
      }),
    });
    const partial = fakeGitHub({
      getPullRequestChecks: vi.fn().mockResolvedValue({
        checks: [{ name: "ci", state: "passed", observedAt }],
        checksCoverage: "partial",
      }),
    });
    const none = fakeGitHub({
      getPullRequestChecks: vi
        .fn()
        .mockResolvedValue({ checks: [], checksCoverage: "complete" }),
    });

    const failed = await gate(failing);
    expect(codes(failed)).toEqual(["checks_not_green"]);
    expect(failed.reasons[0]?.message).toContain("tests (failed)");
    expect(failed.reasons[0]?.message).toContain("build (in_progress)");
    expect((await gate(partial)).reasons[0]?.message).toContain("partial");
    expect((await gate(none)).reasons[0]?.message).toContain("No checks");
    expect(failing.getPullRequestChecks).toHaveBeenCalledWith(
      { owner: "acme", repo: "app" },
      "head-sha-1",
    );
  });

  it("refuses while a review thread is unresolved, and counts it", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue({
        comments: [
          thread("t1", true),
          thread("t2", false),
          thread("t2", false, { id: "t2-c2", inReplyToId: "t2-c1" }),
          thread("t3", false, { isOutdated: true }),
        ],
        commentsTruncated: false,
      }),
    });

    const result = await gate(github);

    expect(codes(result)).toEqual(["review_threads_unresolved"]);
    expect(result.reasons[0]?.message).toContain(
      "2 review threads are unresolved",
    );
  });

  it("refuses when it cannot see all the review threads", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi
        .fn()
        .mockResolvedValue({ comments: [], commentsTruncated: true }),
    });

    expect(codes(await gate(github))).toEqual(["review_threads_incomplete"]);
  });

  it("throws, rather than reporting no threads, when thread data cannot be read", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue(null),
    });
    const noThreadState = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue({
        comments: [{ ...thread("t1", true), threadId: undefined }],
        commentsTruncated: false,
      }),
    });

    await expect(gate(github)).rejects.toMatchObject({
      errorCode: "github_review_threads_unreadable",
    });
    await expect(gate(noThreadState)).rejects.toMatchObject({
      errorCode: "github_review_threads_unreadable",
    });
  });

  it("refuses a pull request a review is blocking, even with an approval from someone else", async () => {
    const changesRequested = {
      author: "reviewer",
      state: "changes_requested",
      commitSha: "head-sha-1",
      authorAssociation: "MEMBER",
      observedAt,
    };
    const withApproval = fakeGitHub({
      listPullRequestReviews: vi.fn().mockResolvedValue({
        reviews: [approvedReview(), changesRequested],
        reviewsTruncated: false,
      }),
    });
    const withoutApproval = fakeGitHub({
      listPullRequestReviews: vi.fn().mockResolvedValue({
        reviews: [changesRequested],
        reviewsTruncated: false,
      }),
    });

    expect(codes(await gate(withApproval))).toEqual(["reviews_blocking"]);
    expect(codes(await gate(withoutApproval))).toEqual([
      "reviews_blocking",
      "approval_required",
    ]);
  });

  it("refuses a conflict, and a branch GitHub has not finished checking", async () => {
    const conflict = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(
          pullRequestSummary({ mergeable: false, mergeableState: "dirty" }),
        ),
    });
    const pending = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(
          pullRequestSummary({ mergeable: null, mergeableState: "unknown" }),
        ),
    });

    expect(codes(await gate(conflict))).toEqual(["merge_conflict"]);
    expect(codes(await gate(pending))).toEqual(["mergeability_pending"]);
  });

  it("refuses a pull request over the size limits without reading its files", async () => {
    const manyFiles = fakeGitHub({
      getPullRequestSummary: vi.fn().mockResolvedValue(
        pullRequestSummary({
          changedFiles: MERGE_GATE_LIMITS.maxChangedFiles + 1,
        }),
      ),
    });
    const manyLines = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(
          pullRequestSummary({ additions: 1_000, deletions: 501 }),
        ),
    });
    const atLimit = fakeGitHub({
      getPullRequestSummary: vi.fn().mockResolvedValue(
        pullRequestSummary({
          additions: 1_000,
          deletions: 500,
          changedFiles: 1,
        }),
      ),
    });

    expect(codes(await gate(manyFiles))).toEqual(["diff_too_large"]);
    expect(codes(await gate(manyLines))).toEqual(["diff_too_large"]);
    expect(manyFiles.listPullRequestChangedFiles).not.toHaveBeenCalled();
    expect((await gate(atLimit)).eligible).toBe(true);
  });

  it.each([
    ["an auth path", "packages/core/src/server/auth-session.ts"],
    ["a migration", "templates/forms/server/db/migrations/0031_add_column.sql"],
    ["a workflow file", ".github/workflows/ci.yml"],
    ["a lockfile", "pnpm-lock.yaml"],
    ["a credential path", "templates/forms/server/lib/credentials.ts"],
    ["a payment path", "templates/forms/server/lib/payments.ts"],
  ])("refuses %s as never-automate", async (_label, file) => {
    const github = fakeGitHub({
      listPullRequestChangedFiles: vi.fn().mockResolvedValue([file]),
    });

    const result = await gate(github);

    expect(codes(result)).toContain("security");
    expect(result.eligible).toBe(false);
    expect(
      result.reasons.find((reason) => reason.code === "security")?.message,
    ).toContain(file);
  });

  it("refuses publishable package source and owner-owned areas", async () => {
    const publishable = fakeGitHub({
      listPullRequestChangedFiles: vi
        .fn()
        .mockResolvedValue(["packages/pinpoint/src/index.ts"]),
    });
    const owned = fakeGitHub({
      listPullRequestChangedFiles: vi
        .fn()
        .mockResolvedValue(["templates/clips/app/components/Player.tsx"]),
    });

    expect(codes(await gate(publishable))).toEqual(["publishable_package"]);
    expect(codes(await gate(owned))).toEqual(["owner_owned"]);
  });

  it("refuses when the changed-file list does not match the count GitHub reports", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ changedFiles: 3 })),
    });
    const empty = fakeGitHub({
      listPullRequestChangedFiles: vi.fn().mockResolvedValue([]),
    });

    expect(codes(await gate(github))).toEqual(["changed_files_unreadable"]);
    expect(codes(await gate(empty))).toEqual(["changed_files_unreadable"]);
  });

  it("reports every reason at once", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ userLogin: "octocat" })),
      getPullRequestChecks: vi.fn().mockResolvedValue({
        checks: [{ name: "tests", state: "failed", observedAt }],
        checksCoverage: "complete",
      }),
      listPullRequestReviewThreads: vi.fn().mockResolvedValue({
        comments: [thread("t1", false)],
        commentsTruncated: false,
      }),
    });

    expect(codes(await gate(github))).toEqual([
      "author_not_builder",
      "checks_not_green",
      "review_threads_unresolved",
    ]);
  });

  it("throws typed failures for a GitHub that could not be read, never ineligible", async () => {
    const down = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockRejectedValue(
          new GitHubRequestError("HTTP 502 - <html>", true, 502),
        ),
    });
    const missing = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockRejectedValue(
          new GitHubRequestError("HTTP 404 - secret", true, 404),
        ),
    });
    const noToken = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockRejectedValue(
          new GitHubRequestError(
            "GITHUB_TOKEN is not configured for this workspace",
            false,
          ),
        ),
    });
    const limited = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockRejectedValue(new GitHubRequestError("HTTP 403", true, 403, true)),
    });
    const tooManyChecks = fakeGitHub({
      getPullRequestChecks: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "GitHub check-run page was truncated; cannot treat CI as complete.",
          ),
        ),
    });

    const failure = await gate(down).catch((error) => error);
    expect(failure).toMatchObject({
      errorCode: "github_request_failed",
      retryable: true,
    });
    expect(failure.message).not.toContain("<html>");
    await expect(gate(missing)).rejects.toMatchObject({
      errorCode: "github_not_found",
    });
    await expect(gate(noToken)).rejects.toMatchObject({
      errorCode: "github_not_connected",
    });
    await expect(gate(limited)).rejects.toMatchObject({
      errorCode: "github_rate_limited",
    });
    await expect(gate(tooManyChecks)).rejects.toMatchObject({
      errorCode: "github_evidence_incomplete",
    });
  });
});

describe("the approving review", () => {
  const reviewed = (
    reviews: readonly Record<string, unknown>[],
    reviewsTruncated = false,
  ) =>
    fakeGitHub({
      listPullRequestReviews: vi
        .fn()
        .mockResolvedValue({ reviews, reviewsTruncated }),
    });
  const noApprovals = {
    seen: 0,
    qualifying: 0,
    byAuthor: 0,
    fromBots: 0,
    fromNonCollaborators: 0,
    stale: 0,
  };

  it("holds a green Builder pull request nobody has approved, and says so with counts", async () => {
    const result = await gate(reviewed([]));

    expect(result.eligible).toBe(false);
    expect(codes(result)).toEqual(["approval_required"]);
    expect(result.reasons[0]).toMatchObject({
      message: expect.stringContaining("has approved the current head commit"),
      counts: noApprovals,
    });
    expect(result.approvals).toEqual(noApprovals);
  });

  it("clears it once an owner, member or collaborator approves the current head commit", async () => {
    const result = await gate(
      reviewed([approvedReview({ authorAssociation: "COLLABORATOR" })]),
    );

    expect(result.eligible).toBe(true);
    expect(result.approvals).toEqual({
      ...noApprovals,
      seen: 1,
      qualifying: 1,
    });
  });

  it("holds it when the pull request's author is its only reviewer", async () => {
    const result = await gate(
      reviewed([
        approvedReview({
          author: "builder-io-integration[bot]",
          authorAssociation: "OWNER",
        }),
      ]),
    );

    expect(codes(result)).toEqual(["approval_required"]);
    expect(result.reasons[0]?.counts).toEqual({
      ...noApprovals,
      seen: 1,
      byAuthor: 1,
    });
    expect(result.reasons[0]?.message).toContain("pull request's own author");
  });

  it("holds it when the approval was given before a later push, and clears it once the new head is approved", async () => {
    const before = approvedReview({ commitSha: "head-sha-0" });

    const stale = await gate(reviewed([before]));
    const renewed = await gate(
      reviewed([before, approvedReview({ commitSha: "head-sha-1" })]),
    );

    expect(codes(stale)).toEqual(["approval_required"]);
    expect(stale.reasons[0]?.counts).toEqual({
      ...noApprovals,
      seen: 1,
      stale: 1,
    });
    expect(stale.reasons[0]?.message).toContain(
      "1 approval on an earlier commit",
    );
    expect(renewed.eligible).toBe(true);
  });

  it("holds it when the only approvals are a bot's and a stranger's, and counts each under its own reason", async () => {
    const result = await gate(
      reviewed([
        approvedReview({
          author: "github-actions[bot]",
          authorAssociation: "CONTRIBUTOR",
        }),
        approvedReview({ author: "stranger", authorAssociation: "NONE" }),
      ]),
    );

    expect(codes(result)).toEqual(["approval_required"]);
    expect(result.reasons[0]?.counts).toEqual({
      ...noApprovals,
      seen: 2,
      fromBots: 1,
      fromNonCollaborators: 1,
    });
    expect(result.reasons[0]?.message).toContain(
      "1 approval from a bot or Builder account",
    );
  });

  it("holds it when a bot approves with a member's association, and when one Builder account approves another's pull request", async () => {
    const byBot = await gate(
      reviewed([
        approvedReview({
          author: "review-app[bot]",
          authorAssociation: "MEMBER",
        }),
      ]),
    );
    const byBuilderBot = await gate(
      fakeGitHub({
        getPullRequestSummary: vi
          .fn()
          .mockResolvedValue(
            pullRequestSummary({ userLogin: "builderio-bot" }),
          ),
        listPullRequestReviews: vi.fn().mockResolvedValue({
          reviews: [
            approvedReview({
              author: "builder-io-integration[bot]",
              authorAssociation: "MEMBER",
            }),
          ],
          reviewsTruncated: false,
        }),
      }),
    );

    for (const result of [byBot, byBuilderBot]) {
      expect(codes(result)).toEqual(["approval_required"]);
      expect(result.reasons[0]?.counts).toEqual({
        ...noApprovals,
        seen: 1,
        fromBots: 1,
      });
    }
  });

  it("holds it when the reviewer who approved later asked for changes, and says both", async () => {
    const result = await gate(
      reviewed([
        approvedReview(),
        approvedReview({ state: "changes_requested" }),
      ]),
    );

    expect(codes(result)).toEqual(["reviews_blocking", "approval_required"]);
  });

  it("finds an approval at the end of a review list longer than a page", async () => {
    const comments = Array.from({ length: 150 }, (_, index) =>
      approvedReview({
        author: `commenter-${index}`,
        state: "commented",
        authorAssociation: "NONE",
      }),
    );

    const result = await gate(reviewed([...comments, approvedReview()]));

    expect(result.eligible).toBe(true);
    expect(result.approvals).toEqual({
      ...noApprovals,
      seen: 1,
      qualifying: 1,
    });
  });

  it("refuses for the reviews it could not read, and does not call an approval missing that may sit in the unread part", async () => {
    const result = await gate(reviewed([], true));

    expect(codes(result)).toEqual(["reviews_incomplete"]);
    expect(result.reasons[0]?.counts).toBeUndefined();
  });

  it("asks a closed or merged pull request for no approval", async () => {
    const closed = fakeGitHub({
      listPullRequestReviews: vi
        .fn()
        .mockResolvedValue({ reviews: [], reviewsTruncated: false }),
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ state: "closed" })),
    });

    expect(codes(await gate(closed))).toEqual(["pull_request_closed"]);
  });
});

describe("merge_gate_snapshot tripwire", () => {
  const TOKEN = "ghp_FAKE0000aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const EMAIL = "pat@example.com";
  const FULL_SHA = "0123456789abcdef0123456789abcdef01234567";

  it("records one snapshot of what the gate judged, never the text or the full SHA", async () => {
    const pullRequest = pullRequestSummary({
      title: `Tighten form sorting for ${EMAIL} ${TOKEN}`,
      body: "Sorts by name. Ask the reviewer.",
      headSha: FULL_SHA,
    });
    const passing = () =>
      fakeGitHub({
        getPullRequestSummary: vi.fn().mockResolvedValue(pullRequest),
        listPullRequestReviews: vi.fn().mockResolvedValue({
          reviews: [approvedReview({ commitSha: FULL_SHA })],
          reviewsTruncated: false,
        }),
        listPullRequestReviewThreads: vi.fn().mockResolvedValue({
          comments: [
            thread("t1", true, { body: `Please check ${TOKEN} ${EMAIL}` }),
          ],
          commentsTruncated: false,
        }),
      });
    const { sink, events } = createCapturingTripwireSink();

    const observed = await gate(passing(), { tripwire: sink });
    const unobserved = await gate(passing());

    expect(observed).toEqual(unobserved);
    const raw = JSON.stringify(events);
    for (const text of [
      TOKEN,
      EMAIL,
      FULL_SHA,
      "Tighten form sorting",
      "Sorts by name",
      "Please check",
    ]) {
      expect(raw).not.toContain(text);
    }
  });
});

describe("gate_read_failed tripwire", () => {
  const TOKEN = "ghp_FAKE0000aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  /** What a caller sees of a gate run: its result, or a failure's typed fields. */
  const outcomeOf = (run: Promise<unknown>) =>
    run.catch((error: { errorCode: string; message: string }) => ({
      errorCode: error.errorCode,
      message: error.message,
    }));

  it.each([
    [
      "a pull request GitHub cannot find",
      "getPullRequestSummary",
      () =>
        new GitHubRequestError(
          `GitHub API request failed: HTTP 404 - {"message":"Not Found ${TOKEN}","status":"404"}`,
          true,
          404,
        ),
      "github_not_found",
    ],
    [
      "a check list that was cut short",
      "getPullRequestChecks",
      () =>
        new Error(
          `GitHub check-run page was truncated; cannot treat CI as complete. ${TOKEN}`,
        ),
      "github_evidence_incomplete",
    ],
    [
      "review threads GitHub cannot list",
      "listPullRequestReviewThreads",
      () => undefined,
      "github_review_threads_unreadable",
    ],
    [
      "a changed-file list GitHub fails to give",
      "listPullRequestChangedFiles",
      () =>
        new GitHubRequestError(
          `GitHub API request failed: HTTP 502 - <html>${TOKEN}</html>`,
          true,
          502,
        ),
      "github_request_failed",
    ],
  ])(
    "%s fails the same way without a sink",
    async (_label, method, failure, errorCode) => {
      const unreadable = () => {
        const outcome = failure();
        return fakeGitHub({
          [method]:
            outcome instanceof Error
              ? vi.fn().mockRejectedValue(outcome)
              : vi.fn().mockResolvedValue(outcome),
        });
      };
      const { sink, events } = createCapturingTripwireSink();

      const observed = await outcomeOf(gate(unreadable(), { tripwire: sink }));
      const unobserved = await outcomeOf(gate(unreadable()));

      expect(observed).toEqual(unobserved);
      expect(observed).toMatchObject({ errorCode });
      expect(JSON.stringify(events)).not.toContain(TOKEN);
    },
  );

  it("a repository it refuses", async () => {
    const github = fakeGitHub();
    const { sink } = createCapturingTripwireSink();

    const result = await gate(github, {
      configuredRepository: "acme/other",
      tripwire: sink,
    });

    expect(result).toMatchObject({ eligible: false, pullRequest: null });
    expect(codes(result)).toEqual(["repository_not_allowed"]);
    expect(github.getPullRequestSummary).not.toHaveBeenCalled();
  });
});
