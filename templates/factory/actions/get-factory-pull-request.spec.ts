import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../server/triage/github-client.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/triage/github-client.js")
  >()),
  createGitHubClient: createClientMock,
}));

import {
  fakeGitHub,
  observedAt,
  pullRequestSummary,
} from "../server/lib/factory-pull-request.fixture.js";
import action from "./get-factory-pull-request.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };
const input = { repo: "acme/app", number: 7 };

function thread(id: string, resolved: boolean) {
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
});

describe("get-factory-pull-request", () => {
  it("is read-only, and reads the head commit's checks", async () => {
    const github = fakeGitHub();
    createClientMock.mockReturnValue(github);

    const result = await action.run(input, context);

    expect(action.readOnly).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      repo: "acme/app",
      number: 7,
      state: "open",
      headSha: "head-sha-1",
      url: "https://github.test/acme/app/pull/7",
      author: {
        login: "builder-io-integration[bot]",
        kind: "builder",
        builderAuthored: true,
      },
      checks: { coverage: "complete", total: 1, passed: 1, allPassing: true },
      reviewThreads: { complete: true, total: 0, unresolved: 0 },
    });
    expect(github.getPullRequestChecks).toHaveBeenCalledWith(
      { owner: "acme", repo: "app" },
      "head-sha-1",
    );
  });

  it("lists what is not passing and the unresolved threads", async () => {
    createClientMock.mockReturnValue(
      fakeGitHub({
        getPullRequestSummary: vi
          .fn()
          .mockResolvedValue(pullRequestSummary({ userLogin: "octocat" })),
        getPullRequestChecks: vi.fn().mockResolvedValue({
          checks: [
            { name: "lint", state: "passed", observedAt },
            { name: "tests", state: "failed", observedAt },
            { name: "build", state: "queued", observedAt },
            { name: "docs", state: "informational", observedAt },
          ],
          checksCoverage: "complete",
        }),
        listPullRequestReviewThreads: vi.fn().mockResolvedValue({
          comments: [thread("t1", true), thread("t2", false)],
          commentsTruncated: false,
        }),
      }),
    );

    const result = (await action.run(input, context)) as Record<string, any>;

    expect(result.author).toMatchObject({
      kind: "human",
      builderAuthored: false,
    });
    expect(result.checks).toMatchObject({
      total: 4,
      passed: 1,
      failed: 1,
      pending: 1,
      informational: 1,
      allPassing: false,
      notPassing: [
        { name: "tests", state: "failed" },
        { name: "build", state: "queued" },
        { name: "docs", state: "informational" },
      ],
      notPassingTruncated: false,
    });
    expect(result.reviewThreads).toMatchObject({
      total: 2,
      unresolved: 1,
      unresolvedThreads: [{ threadId: "t2", path: "a.ts" }],
    });
  });

  it("fails rather than report no threads when the thread data cannot be read", async () => {
    createClientMock.mockReturnValue(
      fakeGitHub({
        listPullRequestReviewThreads: vi.fn().mockResolvedValue(null),
      }),
    );

    await expect(action.run(input, context)).rejects.toMatchObject({
      errorCode: "github_review_threads_unreadable",
    });
  });

  it("bounds long lists and says it did", async () => {
    const manyThreads = Array.from({ length: 30 }, (_, index) =>
      thread(`t${index}`, false),
    );
    const manyChecks = Array.from({ length: 80 }, (_, index) => ({
      name: `check-${index}`,
      state: "failed",
      observedAt,
    }));
    createClientMock.mockReturnValue(
      fakeGitHub({
        getPullRequestChecks: vi.fn().mockResolvedValue({
          checks: manyChecks,
          checksCoverage: "complete",
        }),
        listPullRequestReviewThreads: vi.fn().mockResolvedValue({
          comments: manyThreads,
          commentsTruncated: false,
        }),
      }),
    );

    const result = (await action.run(input, context)) as Record<string, any>;

    expect(result.checks.notPassing).toHaveLength(60);
    expect(result.checks.notPassingTruncated).toBe(true);
    expect(result.checks.failed).toBe(80);
    expect(result.reviewThreads.unresolvedThreads).toHaveLength(20);
    expect(result.reviewThreads.unresolvedThreadsTruncated).toBe(true);
    expect(result.reviewThreads.unresolved).toBe(30);
    expect(JSON.stringify(result).length).toBeLessThan(40_000);
  });

  it("refuses a repository it cannot parse, and a caller the gate refuses", async () => {
    createClientMock.mockReturnValue(fakeGitHub());

    await expect(
      action.run({ repo: "not a repo", number: 7 }, context),
    ).rejects.toMatchObject({ errorCode: "github_repository_invalid" });
    requireCallerMock.mockRejectedValue(new Error("not allowed"));
    createClientMock.mockClear();
    await expect(action.run(input, context)).rejects.toThrow("not allowed");
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
