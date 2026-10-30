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
import { VERIFICATION_EXCERPT_CHARS } from "../server/lib/pull-request-evidence.js";
import { GitHubRequestError } from "../server/triage/github-client.js";
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
      verification: {
        present: true,
        hasMedia: false,
        excerpt:
          "Ran the form list spec: it fails without the change and passes with it.",
      },
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

  describe("verification", () => {
    const read = async (body: string | null) => {
      createClientMock.mockReturnValue(
        fakeGitHub({
          getPullRequestSummary: vi
            .fn()
            .mockResolvedValue(pullRequestSummary({ body })),
        }),
      );
      return (await action.run(input, context)) as Record<string, any>;
    };

    it("summarizes the Verified section and returns nothing else of the description", async () => {
      const result = await read(
        [
          "PLANTED-SUMMARY-TEXT that stays in the description.",
          "",
          '<a href="https://builder.example.test/edit"><img src="https://cdn.example.test/edit.png" alt="Edit"></a>',
          "",
          "<!-- FUSION_SCREENSHOTS_START -->",
          "### Verified",
          "",
          "[Watch the run](https://www.builder.io/app/timelines/abc123)",
          '<img src="https://storage.example.test/after.webp" alt="After: the list is sorted" />',
          "Ran the form list spec and it passed.",
          "<!-- FUSION_SCREENSHOTS_END -->",
          "",
          "---",
          "PLANTED-FOOTER-TEXT and a clone command.",
        ].join("\n"),
      );

      expect(result.verification).toEqual({
        present: true,
        hasMedia: true,
        excerpt: "Watch the run Ran the form list spec and it passed.",
      });
      const raw = JSON.stringify(result);
      for (const leaked of [
        "PLANTED-SUMMARY-TEXT",
        "PLANTED-FOOTER-TEXT",
        "builder.example.test",
        "cdn.example.test",
        "storage.example.test",
        "FUSION_",
      ]) {
        expect(raw, leaked).not.toContain(leaked);
      }
      expect(JSON.stringify(result.verification)).not.toMatch(/https?:|<img/);
      expect(result).not.toHaveProperty("body");
    });

    it("clips a long section to its bound and keeps the whole result small", async () => {
      const result = await read(
        `### Verified\n${"Ran the form list spec and it passed. ".repeat(2_000)}`,
      );

      expect(result.verification.present).toBe(true);
      expect(result.verification.excerpt.length).toBeLessThanOrEqual(
        VERIFICATION_EXCERPT_CHARS,
      );
      expect(JSON.stringify(result).length).toBeLessThan(10_000);
    });

    it("says absent, not an error, for a description with no Verified section or none at all", async () => {
      const absent = { present: false, hasMedia: false, excerpt: "" };

      expect((await read(null)).verification).toEqual(absent);
      expect((await read("")).verification).toEqual(absent);
      expect((await read("Only a summary here.")).verification).toEqual(absent);
    });

    it("fails, rather than report an absent section, when the pull request cannot be read", async () => {
      createClientMock.mockReturnValue(
        fakeGitHub({
          getPullRequestSummary: vi
            .fn()
            .mockRejectedValue(
              new GitHubRequestError("HTTP 502 - <html>", true, 502),
            ),
        }),
      );

      await expect(action.run(input, context)).rejects.toMatchObject({
        errorCode: "github_request_failed",
      });
    });
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
