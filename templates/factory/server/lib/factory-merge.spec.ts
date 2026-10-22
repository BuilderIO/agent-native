import { describe, expect, it, vi } from "vitest";

import {
  GitHubMergeNotCompletedError,
  GitHubRequestError,
} from "../triage/github-client.js";
import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import type { TripwireSink } from "../tripwire/types.js";
import { chooseMergeMethod, mergeGatedPullRequest } from "./factory-merge.js";
import {
  approvedReview,
  fakeGitHub,
  observedAt,
  pullRequestSummary,
} from "./factory-pull-request.fixture.js";
import type { GitHubClient } from "./factory-pull-request.js";
import type { WorkflowActionError } from "./workflow-action-errors.js";

function merge(
  github: ReturnType<typeof fakeGitHub>,
  overrides: {
    mergeMethod?: "squash" | "merge" | "rebase";
    configuredRepository?: string | null;
    tripwire?: TripwireSink;
  } = {},
) {
  return mergeGatedPullRequest({
    github: github as unknown as GitHubClient,
    repository: { owner: "acme", repo: "app" },
    repositoryLabel: "acme/app",
    number: 7,
    mergeMethod: overrides.mergeMethod ?? "squash",
    configuredRepository:
      overrides.configuredRepository === undefined
        ? "acme/app"
        : overrides.configuredRepository,
    tripwire: overrides.tripwire,
  });
}

const unresolvedThread = {
  id: "c1",
  author: "reviewer",
  inReplyToId: null,
  body: "Please rename this.",
  createdAt: observedAt,
  isResolved: false,
  isOutdated: false,
  threadId: "t1",
};

describe("chooseMergeMethod", () => {
  const settings = (
    squash: boolean,
    mergeCommit: boolean,
    rebase: boolean,
  ) => ({
    allowSquashMerge: squash,
    allowMergeCommit: mergeCommit,
    allowRebaseMerge: rebase,
  });

  it("uses the requested method when the repository allows it, else the first it allows", () => {
    expect(chooseMergeMethod("rebase", settings(true, true, true))).toBe(
      "rebase",
    );
    expect(chooseMergeMethod("squash", settings(false, true, true))).toBe(
      "merge",
    );
    expect(chooseMergeMethod("squash", settings(false, false, true))).toBe(
      "rebase",
    );
    expect(
      chooseMergeMethod("squash", settings(false, false, false)),
    ).toBeNull();
  });
});

describe("mergeGatedPullRequest", () => {
  it("merges a pull request the gate clears, pinned to the head commit it checked", async () => {
    const github = fakeGitHub();

    const result = await merge(github);

    expect(result).toEqual({
      sha: "merge-sha",
      url: "https://github.test/acme/app/pull/7",
      headSha: "head-sha-1",
      mergeMethod: "squash",
      alreadyMerged: false,
      reconciled: false,
    });
    expect(github.mergePullRequest).toHaveBeenCalledWith(
      { owner: "acme", repo: "app" },
      7,
      undefined,
      "head-sha-1",
      "squash",
    );
  });

  it("runs the gate itself and refuses to merge a pull request it does not clear", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue({
        comments: [unresolvedThread],
        commentsTruncated: false,
      }),
    });

    await expect(merge(github)).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
      sideEffect: "none",
      statusCode: 409,
      details: { reasonCodes: ["review_threads_unresolved"] },
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(github.getRepositoryMergeSettings).not.toHaveBeenCalled();
  });

  it("re-reads the pull request on every call, so a gate that passed earlier does not carry over", async () => {
    const green = pullRequestSummary();
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValueOnce(green)
        .mockResolvedValueOnce(pullRequestSummary({ headSha: "head-sha-2" })),
      getPullRequestChecks: vi
        .fn()
        .mockResolvedValueOnce({
          checks: [{ name: "ci", state: "passed", observedAt }],
          checksCoverage: "complete",
        })
        .mockResolvedValueOnce({
          checks: [{ name: "ci", state: "failed", observedAt }],
          checksCoverage: "complete",
        }),
    });

    await expect(merge(github)).resolves.toMatchObject({ sha: "merge-sha" });
    await expect(merge(github)).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
    });
    expect(github.mergePullRequest).toHaveBeenCalledTimes(1);
  });

  it("refuses a repository that is not the factory's without calling GitHub", async () => {
    const github = fakeGitHub();

    await expect(
      merge(github, { configuredRepository: "acme/other" }),
    ).rejects.toMatchObject({ errorCode: "merge_gate_ineligible" });
    expect(github.getPullRequestSummary).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("does nothing, and says so, for a pull request that is already merged", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi.fn().mockResolvedValue(
        pullRequestSummary({
          state: "closed",
          merged: true,
          mergeCommitSha: "earlier-merge-sha",
        }),
      ),
    });

    await expect(merge(github)).resolves.toMatchObject({
      sha: "earlier-merge-sha",
      alreadyMerged: true,
      mergeMethod: null,
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("fails rather than invent a sha for a merged pull request with no merge commit", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(
          pullRequestSummary({ state: "closed", merged: true }),
        ),
    });

    await expect(merge(github)).rejects.toMatchObject({
      errorCode: "merge_commit_unreadable",
      sideEffect: "none",
      retryable: true,
    });
  });

  it("takes the method from the repository's settings", async () => {
    const onlyRebase = fakeGitHub({
      getRepositoryMergeSettings: vi.fn().mockResolvedValue({
        allowSquashMerge: false,
        allowMergeCommit: false,
        allowRebaseMerge: true,
      }),
    });
    const none = fakeGitHub({
      getRepositoryMergeSettings: vi.fn().mockResolvedValue({
        allowSquashMerge: false,
        allowMergeCommit: false,
        allowRebaseMerge: false,
      }),
    });

    await expect(merge(onlyRebase)).resolves.toMatchObject({
      mergeMethod: "rebase",
    });
    expect(onlyRebase.mergePullRequest.mock.calls[0]?.[4]).toBe("rebase");
    await expect(merge(none)).rejects.toMatchObject({
      errorCode: "merge_method_unavailable",
    });
    expect(none.mergePullRequest).not.toHaveBeenCalled();
  });

  it("fails typed, with no merge attempted, when the settings cannot be read", async () => {
    const github = fakeGitHub({
      getRepositoryMergeSettings: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "GitHub response is missing repository squash-merge setting",
          ),
        ),
    });

    await expect(merge(github)).rejects.toMatchObject({
      errorCode: "github_response_invalid",
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it.each([
    [409, "merge_head_changed"],
    [405, "merge_not_allowed"],
    [422, "merge_not_allowed"],
    [404, "github_not_found"],
    [403, "github_access_denied"],
  ])(
    "maps GitHub's %i to %s, with no side effect",
    async (status, errorCode) => {
      const github = fakeGitHub({
        mergePullRequest: vi
          .fn()
          .mockRejectedValue(
            new GitHubRequestError(`HTTP ${status} - body`, true, status),
          ),
      });

      const failure = await merge(github).catch((error) => error);

      expect(failure).toMatchObject({ errorCode, sideEffect: "none" });
      expect(github.getPullRequestSummary).toHaveBeenCalledTimes(1);
    },
  );

  it("treats merged: false as a refusal, and a missing token as not connected", async () => {
    const refused = fakeGitHub({
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(
          new GitHubMergeNotCompletedError("GitHub merge was not completed: x"),
        ),
    });
    const noToken = fakeGitHub({
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(
          new GitHubRequestError("GITHUB_TOKEN is not configured", false),
        ),
    });
    const limited = fakeGitHub({
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(new GitHubRequestError("HTTP 403", true, 403, true)),
    });

    await expect(merge(refused)).rejects.toMatchObject({
      errorCode: "merge_rejected",
    });
    await expect(merge(noToken)).rejects.toMatchObject({
      errorCode: "github_not_connected",
    });
    await expect(merge(limited)).rejects.toMatchObject({
      errorCode: "github_rate_limited",
      retryable: true,
    });
  });

  it("reads the pull request back after a failure that may have merged it", async () => {
    const mergedAfterAll = pullRequestSummary({
      state: "closed",
      merged: true,
      mergeCommitSha: "late-merge-sha",
    });
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValueOnce(pullRequestSummary())
        .mockResolvedValueOnce(mergedAfterAll),
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(new GitHubRequestError("HTTP 502", true, 502)),
    });

    await expect(merge(github)).resolves.toMatchObject({
      sha: "late-merge-sha",
      reconciled: true,
      alreadyMerged: false,
    });
  });

  it("reports an unknown outcome when the read-back finds no merge, or cannot be done", async () => {
    const notMerged = fakeGitHub({
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(new GitHubRequestError("HTTP 502", true, 502)),
    });
    const unreadable = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValueOnce(pullRequestSummary())
        .mockRejectedValueOnce(new GitHubRequestError("HTTP 502", true, 502)),
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(new GitHubRequestError("socket hang up", true)),
    });

    for (const github of [notMerged, unreadable]) {
      await expect(merge(github)).rejects.toMatchObject({
        errorCode: "merge_outcome_unknown",
        sideEffect: "maybe",
        details: { headSha: "head-sha-1" },
      });
    }
  });

  it("reads back after an answer it could not parse, because the merge may have gone through", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValueOnce(pullRequestSummary())
        .mockResolvedValueOnce(
          pullRequestSummary({
            state: "closed",
            merged: true,
            mergeCommitSha: "parsed-later-sha",
          }),
        ),
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(new Error("GitHub response is missing merge SHA")),
    });

    await expect(merge(github)).resolves.toMatchObject({
      sha: "parsed-later-sha",
      reconciled: true,
    });
  });
});

// Planted into GitHub's text and the thrown errors: no tripwire may store them.
const PLANTED_TOKEN = "ghp_FAKE0000aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PLANTED_EMAIL = "pat@example.com";

/** What a caller sees of a merge: its receipt, or a failure's typed fields. */
function outcomeOf(run: Promise<unknown>) {
  return run.catch((error: WorkflowActionError) => ({
    errorCode: error.errorCode,
    message: error.message,
    statusCode: error.statusCode,
    sideEffect: error.sideEffect,
    retryable: error.retryable,
    details: error.details,
  }));
}

describe("merge_blocked tripwire", () => {
  it.each([
    [409, "merge_head_changed"],
    [405, "merge_not_allowed"],
  ])(
    "records GitHub's %i refusal and fails the same way without a sink",
    async (status, code) => {
      const refusing = () =>
        fakeGitHub({
          mergePullRequest: vi
            .fn()
            .mockRejectedValue(
              new GitHubRequestError(
                `GitHub request failed: HTTP ${status} - ${PLANTED_TOKEN} ${PLANTED_EMAIL}`,
                true,
                status,
              ),
            ),
        });
      const { sink, events } = createCapturingTripwireSink();

      const observed = await outcomeOf(merge(refusing(), { tripwire: sink }));
      const unobserved = await outcomeOf(merge(refusing()));

      expect(observed).toEqual(unobserved);
      expect(observed).toMatchObject({ errorCode: code, sideEffect: "none" });
      expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
      expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
    },
  );

  it("records a refusal by the gate, and no thread text", async () => {
    const blocked = () =>
      fakeGitHub({
        listPullRequestReviewThreads: vi.fn().mockResolvedValue({
          comments: [
            {
              ...unresolvedThread,
              body: `Ask ${PLANTED_EMAIL} about ${PLANTED_TOKEN}`,
            },
          ],
          commentsTruncated: false,
        }),
      });
    const { sink, events } = createCapturingTripwireSink();

    const observed = await outcomeOf(merge(blocked(), { tripwire: sink }));
    const unobserved = await outcomeOf(merge(blocked()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_gate_ineligible",
      statusCode: 409,
    });
    expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
    expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
  });

  it("refuses to merge a fork's pull request, or one aimed at a non-default branch", async () => {
    const fromFork = () =>
      fakeGitHub({
        getPullRequestSummary: vi.fn().mockResolvedValue(
          pullRequestSummary({
            headRepository: "someone-else/app",
            baseRef: "release",
          }),
        ),
      });
    const { sink } = createCapturingTripwireSink();
    const watched = fromFork();

    const observed = await outcomeOf(merge(watched, { tripwire: sink }));
    const unobserved = await outcomeOf(merge(fromFork()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_gate_ineligible",
      statusCode: 409,
    });
    expect(watched.mergePullRequest).not.toHaveBeenCalled();
  });

  it("refuses to merge a green pull request with no current approval", async () => {
    const unapproved = () =>
      fakeGitHub({
        listPullRequestReviews: vi.fn().mockResolvedValue({
          reviews: [approvedReview({ commitSha: "head-sha-0" })],
          reviewsTruncated: false,
        }),
      });
    const { sink } = createCapturingTripwireSink();
    const watched = unapproved();

    const observed = await outcomeOf(merge(watched, { tripwire: sink }));
    const unobserved = await outcomeOf(merge(unapproved()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_gate_ineligible",
      statusCode: 409,
      details: { reasonCodes: ["approval_required"] },
    });
    expect(watched.mergePullRequest).not.toHaveBeenCalled();
  });

  it("a repository that allows no merge method, before any merge request", async () => {
    const closed = () =>
      fakeGitHub({
        getRepositoryMergeSettings: vi.fn().mockResolvedValue({
          allowSquashMerge: false,
          allowMergeCommit: false,
          allowRebaseMerge: false,
        }),
      });
    const { sink } = createCapturingTripwireSink();
    const watched = closed();

    const observed = await outcomeOf(merge(watched, { tripwire: sink }));
    const unobserved = await outcomeOf(merge(closed()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_method_unavailable",
      statusCode: 409,
      sideEffect: "none",
    });
    expect(watched.mergePullRequest).not.toHaveBeenCalled();
  });
});

describe("merge_unexpected_response tripwire", () => {
  it("records a 2xx answer that does not say merged and fails as merge_rejected", async () => {
    const unmerged = () =>
      fakeGitHub({
        mergePullRequest: vi
          .fn()
          .mockRejectedValue(
            new GitHubMergeNotCompletedError(
              `GitHub merge was not completed: ${PLANTED_TOKEN} ${PLANTED_EMAIL}`,
            ),
          ),
      });
    const { sink, events } = createCapturingTripwireSink();

    const observed = await outcomeOf(merge(unmerged(), { tripwire: sink }));
    const unobserved = await outcomeOf(merge(unmerged()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_rejected",
      statusCode: 409,
    });
    expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
    expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
  });

  it("records a 2xx answer with no merge sha, reads the pull request back, and reports an unknown outcome", async () => {
    const shaless = () =>
      fakeGitHub({
        mergePullRequest: vi
          .fn()
          .mockRejectedValue(
            new Error(
              `GitHub response is missing merge SHA ${PLANTED_TOKEN} ${PLANTED_EMAIL}`,
            ),
          ),
      });
    const { sink, events } = createCapturingTripwireSink();

    const observed = await outcomeOf(merge(shaless(), { tripwire: sink }));
    const unobserved = await outcomeOf(merge(shaless()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_outcome_unknown",
      statusCode: 424,
      sideEffect: "maybe",
    });
    const stored = sanitizeDetails(events[1].details).fields;
    expect(JSON.stringify(stored)).toContain("[redacted]");
    expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
    expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
  });

  it("records a 5xx answer, reads the pull request back, and reports an unknown outcome", async () => {
    const failing = () =>
      fakeGitHub({
        mergePullRequest: vi
          .fn()
          .mockRejectedValue(
            new GitHubRequestError(
              `GitHub request failed: HTTP 502 - ${PLANTED_TOKEN} ${PLANTED_EMAIL}`,
              true,
              502,
            ),
          ),
      });
    const { sink, events } = createCapturingTripwireSink();
    const watched = failing();
    const bare = failing();

    const observed = await outcomeOf(merge(watched, { tripwire: sink }));
    const unobserved = await outcomeOf(merge(bare));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_outcome_unknown",
      statusCode: 424,
      sideEffect: "maybe",
    });
    expect(watched.getPullRequestSummary).toHaveBeenCalledTimes(2);
    expect(bare.getPullRequestSummary).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
    expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
  });

  it.each([
    [401, "github_access_denied"],
    [403, "github_access_denied"],
    [404, "github_not_found"],
  ])(
    "records GitHub's %i on the merge request, never the text, and fails the same way without a sink",
    async (status, errorCode) => {
      const body = JSON.stringify({
        message: `Bad credentials ${PLANTED_TOKEN} ${PLANTED_EMAIL}`,
        documentation_url: "https://docs.github.com/rest",
        status: String(status),
      });
      const refusing = () =>
        fakeGitHub({
          mergePullRequest: vi
            .fn()
            .mockRejectedValue(
              new GitHubRequestError(
                `GitHub API request failed: HTTP ${status} - ${body}`,
                true,
                status,
              ),
            ),
        });
      const { sink, events } = createCapturingTripwireSink();
      const watched = refusing();

      const observed = await outcomeOf(merge(watched, { tripwire: sink }));
      const unobserved = await outcomeOf(merge(refusing()));

      expect(observed).toEqual(unobserved);
      expect(observed).toMatchObject({ errorCode, sideEffect: "none" });
      expect(watched.getPullRequestSummary).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
      expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
    },
  );

  it.each([
    ["a body that is not JSON", ` - <html>${PLANTED_TOKEN}</html>`, "string"],
    ["no body", "", "undefined"],
  ])(
    "records a refusal with %s as that shape",
    async (_label, suffix, bodyShape) => {
      const github = fakeGitHub({
        mergePullRequest: vi
          .fn()
          .mockRejectedValue(
            new GitHubRequestError(
              `GitHub API request failed: HTTP 403${suffix}`,
              true,
              403,
            ),
          ),
      });
      const { sink, events } = createCapturingTripwireSink();

      await outcomeOf(merge(github, { tripwire: sink }));

      expect(sanitizeDetails(events[1].details).fields).toEqual({
        reason: "non_2xx",
        status: 403,
        bodyShape,
      });
      expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
    },
  );

  it("marks a rate-limited refusal as rate limited", async () => {
    const github = fakeGitHub({
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(
          new GitHubRequestError(
            "GitHub API request failed: HTTP 429",
            true,
            429,
            true,
          ),
        ),
    });
    const { sink } = createCapturingTripwireSink();

    const observed = await outcomeOf(merge(github, { tripwire: sink }));

    expect(observed).toMatchObject({ errorCode: "github_rate_limited" });
  });

  it("records a dropped connection as its own reason, with the error's class and no status, then reads the pull request back", async () => {
    const dropped = () =>
      fakeGitHub({
        mergePullRequest: vi
          .fn()
          .mockRejectedValue(
            new GitHubRequestError(
              `fetch failed ${PLANTED_TOKEN} ${PLANTED_EMAIL}`,
              true,
            ),
          ),
      });
    const { sink, events } = createCapturingTripwireSink();
    const watched = dropped();

    const observed = await outcomeOf(merge(watched, { tripwire: sink }));
    const unobserved = await outcomeOf(merge(dropped()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({
      errorCode: "merge_outcome_unknown",
      sideEffect: "maybe",
    });
    expect(watched.getPullRequestSummary).toHaveBeenCalledTimes(2);
    const stored = sanitizeDetails(events[1].details).fields;
    expect(stored).not.toHaveProperty("status");
    expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
    expect(JSON.stringify(events)).not.toContain(PLANTED_EMAIL);
  });

  it("when no request was sent, because there was no token", async () => {
    const github = fakeGitHub({
      mergePullRequest: vi
        .fn()
        .mockRejectedValue(
          new GitHubRequestError("GITHUB_TOKEN is not configured", false),
        ),
    });
    const { sink } = createCapturingTripwireSink();

    const observed = await outcomeOf(merge(github, { tripwire: sink }));

    expect(observed).toMatchObject({ errorCode: "github_not_connected" });
  });

  it.each([
    [
      "a refusal",
      () =>
        new GitHubRequestError(
          `GitHub API request failed: HTTP 403 - {"message":"Resource not accessible by personal access token"}`,
          true,
          403,
        ),
      "github_access_denied",
    ],
    [
      "an answer without the settings",
      () =>
        new Error(
          `GitHub response is missing repository squash-merge setting ${PLANTED_TOKEN}`,
        ),
      "github_response_invalid",
    ],
  ])(
    "records the repository settings read failing as %s and fails the same way without a sink",
    async (_label, failure, errorCode) => {
      const failing = () =>
        fakeGitHub({
          getRepositoryMergeSettings: vi.fn().mockRejectedValue(failure()),
        });
      const { sink, events } = createCapturingTripwireSink();

      const observed = await outcomeOf(merge(failing(), { tripwire: sink }));
      const unobserved = await outcomeOf(merge(failing()));

      expect(observed).toEqual(unobserved);
      expect(observed).toMatchObject({ errorCode, sideEffect: "none" });
      expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
    },
  );
});

describe("merge_gate_snapshot tripwire", () => {
  it("a merge that goes through", async () => {
    const { sink } = createCapturingTripwireSink();

    const observed = await merge(fakeGitHub(), { tripwire: sink });
    const unobserved = await merge(fakeGitHub());

    expect(observed).toMatchObject({ sha: "merge-sha", alreadyMerged: false });
    expect(observed).toEqual(unobserved);
  });
});

describe("a merge attempt that reaches evaluation", () => {
  it("a pull request that is already merged", async () => {
    const merged = () =>
      fakeGitHub({
        getPullRequestSummary: vi.fn().mockResolvedValue(
          pullRequestSummary({
            state: "closed",
            merged: true,
            mergeCommitSha: "earlier-merge-sha",
          }),
        ),
      });
    const { sink } = createCapturingTripwireSink();

    const observed = await merge(merged(), { tripwire: sink });
    const unobserved = await merge(merged());

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({ alreadyMerged: true });
  });

  it("a repository it refuses before reading anything", async () => {
    const github = fakeGitHub();
    const { sink } = createCapturingTripwireSink();

    const observed = await outcomeOf(
      merge(github, { configuredRepository: "acme/other", tripwire: sink }),
    );

    expect(observed).toMatchObject({ errorCode: "merge_gate_ineligible" });
    expect(github.getPullRequestSummary).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a refusal",
      () =>
        new GitHubRequestError(
          `GitHub API request failed: HTTP 401 - {"message":"Bad credentials ${PLANTED_TOKEN}"}`,
          true,
          401,
        ),
      "github_access_denied",
    ],
    [
      "a dropped connection",
      () => new GitHubRequestError(`fetch failed ${PLANTED_TOKEN}`, true),
      "github_request_failed",
    ],
  ])("when GitHub cannot be read: %s", async (_label, failure, errorCode) => {
    const unreadable = () =>
      fakeGitHub({
        getPullRequestSummary: vi.fn().mockRejectedValue(failure()),
      });
    const { sink, events } = createCapturingTripwireSink();
    const watched = unreadable();

    const observed = await outcomeOf(merge(watched, { tripwire: sink }));
    const unobserved = await outcomeOf(merge(unreadable()));

    expect(observed).toEqual(unobserved);
    expect(observed).toMatchObject({ errorCode, sideEffect: "none" });
    expect(watched.mergePullRequest).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain(PLANTED_TOKEN);
  });
});
