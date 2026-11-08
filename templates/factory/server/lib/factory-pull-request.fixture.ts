import { vi } from "vitest";

/** A GitHub client double and a pull request it returns, for the PR and merge specs. */
export const observedAt = "2026-10-14T12:00:00.000Z";

/** A description with the `### Verified` section Builder is asked for. */
export const verifiedBody =
  "Sorts the form list by name.\n\n### Verified\n\nRan the form list spec: it fails without the change and passes with it.";

/** What the fake pull request changes: a source file and the test that covers it. */
export const changedSourceFile = "templates/forms/app/components/FormList.tsx";
export const changedTestFile =
  "templates/forms/app/components/FormList.spec.tsx";
export const changedFileNames = [changedSourceFile, changedTestFile];

export function pullRequestSummary(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: "Fix the form list sorting",
    body: verifiedBody,
    state: "open",
    draft: false,
    merged: false,
    mergedAt: null,
    htmlUrl: "https://github.test/acme/app/pull/7",
    userId: 1,
    userLogin: "builder-io-integration[bot]",
    headSha: "head-sha-1",
    headRef: "factory-group-1",
    baseRef: "main",
    headRepository: "acme/app",
    baseRepository: "acme/app",
    baseDefaultBranch: "main",
    createdAt: observedAt,
    updatedAt: observedAt,
    additions: 20,
    deletions: 5,
    changedFiles: changedFileNames.length,
    mergeable: true,
    mergeableState: "clean",
    reviewComments: 0,
    ...overrides,
  };
}

/** An approval by a collaborator on the fake pull request's head commit: what a pull request needs to merge. */
export function approvedReview(overrides: Record<string, unknown> = {}) {
  return {
    author: "maintainer",
    state: "approved",
    commitSha: "head-sha-1",
    authorAssociation: "MEMBER",
    observedAt,
    ...overrides,
  };
}

export function fakeGitHub(overrides: Record<string, unknown> = {}) {
  return {
    getPullRequestSummary: vi.fn().mockResolvedValue(pullRequestSummary()),
    listPullRequestReviews: vi.fn().mockResolvedValue({
      reviews: [approvedReview()],
      reviewsTruncated: false,
    }),
    listPullRequestReviewThreads: vi
      .fn()
      .mockResolvedValue({ comments: [], commentsTruncated: false }),
    getPullRequestChecks: vi.fn().mockResolvedValue({
      checks: [{ name: "ci", state: "passed", observedAt }],
      checksCoverage: "complete",
    }),
    listPullRequestChangedFiles: vi.fn().mockResolvedValue(changedFileNames),
    getRepositoryMergeSettings: vi.fn().mockResolvedValue({
      allowSquashMerge: true,
      allowMergeCommit: true,
      allowRebaseMerge: true,
    }),
    mergePullRequest: vi
      .fn()
      .mockResolvedValue({ sha: "merge-sha", merged: true, message: "Merged" }),
    ...overrides,
  };
}
