import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BABYSIT_BOT_AUTHORS,
  isBabysitBotAuthor,
} from "../triage/pr-babysit.js";
import {
  fakeGitHub,
  observedAt,
  pullRequestSummary,
} from "./factory-pull-request.fixture.js";
import {
  BUILDER_MERGE_AUTHOR_LOGINS,
  classifyPullRequestAuthor,
  parseRepositoryInput,
  readPullRequestEvidence,
} from "./factory-pull-request.js";
import type { GitHubClient } from "./factory-pull-request.js";

describe("classifyPullRequestAuthor", () => {
  it("knows exactly the two accounts Builder merges as, in any case", () => {
    expect(BUILDER_MERGE_AUTHOR_LOGINS).toEqual([
      "builderio-bot",
      "builder-io-integration[bot]",
    ]);
    for (const login of [
      "builderio-bot",
      "BuilderIO-Bot",
      "builder-io-integration[bot]",
      "Builder-IO-Integration[BOT]",
    ]) {
      expect(classifyPullRequestAuthor(login, 1)).toBe("builder");
    }
  });

  it.each([
    // Names the babysit list calls Builder's, which may not make a pull request merge.
    ["builder-io-bot", "human"],
    ["builder-io-integration", "human"],
    ["builder-io-bot[bot]", "bot"],
    ["builderio-bot[bot]", "bot"],
    ["builderio[bot]", "bot"],
    // Lookalikes.
    ["builderio-bot2", "human"],
    ["builderio-botx", "human"],
    ["xbuilderio-bot", "human"],
    ["builder-io-integration[bot]x", "human"],
    ["builder-io-integration-fan", "human"],
    // Everyone else.
    ["dependabot[bot]", "bot"],
    ["github-actions[bot]", "bot"],
    ["octocat", "human"],
  ] as const)("does not take %s for Builder", (login, kind) => {
    expect(classifyPullRequestAuthor(login, 2)).toBe(kind);
  });

  it("leaves the review-bot list the babysit code reads as it was", () => {
    // The merge allow-list is narrower on purpose; narrowing this one would change who babysit treats as a bot.
    expect(DEFAULT_BABYSIT_BOT_AUTHORS).toEqual([
      "builder-io-bot",
      "builder-io-bot[bot]",
      "builderio-bot",
      "builderio-bot[bot]",
      "builderio[bot]",
      "builder-io-integration",
      "builder-io-integration[bot]",
      "github-actions",
      "github-actions[bot]",
      "dependabot[bot]",
    ]);
    expect(isBabysitBotAuthor("builder-io-bot")).toBe(true);
    expect(classifyPullRequestAuthor("builder-io-bot", 2)).not.toBe("builder");
  });

  it("judges by login alone when no verified ids are given, and otherwise requires the author's id to be on the list", () => {
    expect(classifyPullRequestAuthor("builderio-bot", 7, [])).toBe("builder");
    const ids = [1001, 1002];
    expect(classifyPullRequestAuthor("builderio-bot", 1002, ids)).toBe(
      "builder",
    );
    expect(classifyPullRequestAuthor("builderio-bot", 999, ids)).toBe("human");
    expect(
      classifyPullRequestAuthor("builder-io-integration[bot]", 999, ids),
    ).toBe("bot");
    // A person's id on the list does not make their login Builder's.
    expect(classifyPullRequestAuthor("octocat", 1001, ids)).toBe("human");
  });
});

describe("parseRepositoryInput", () => {
  it("reads owner/name and a URL, and fails typed on anything else", () => {
    expect(parseRepositoryInput("acme/app")).toEqual({
      owner: "acme",
      repo: "app",
    });
    expect(parseRepositoryInput("https://github.com/acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
    });
    expect(() => parseRepositoryInput("nonsense")).toThrow(
      expect.objectContaining({ errorCode: "github_repository_invalid" }),
    );
  });
});

describe("readPullRequestEvidence", () => {
  const repository = { owner: "acme", repo: "app" };
  const read = (github: ReturnType<typeof fakeGitHub>) =>
    readPullRequestEvidence(github as unknown as GitHubClient, repository, 7);

  it("groups review comments into threads and keeps each thread's state", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue({
        comments: [
          {
            id: "1",
            author: "reviewer",
            inReplyToId: null,
            body: "  Please\nrename this   one  ",
            path: "a.ts",
            line: 3,
            createdAt: observedAt,
            isResolved: false,
            isOutdated: true,
            threadId: "t1",
          },
          {
            id: "2",
            author: "builder-io-bot",
            inReplyToId: "1",
            body: "Fixed",
            createdAt: observedAt,
            isResolved: false,
            isOutdated: true,
            threadId: "t1",
          },
        ],
        commentsTruncated: false,
      }),
    });

    const evidence = await read(github);

    expect(evidence.threads).toEqual([
      {
        threadId: "t1",
        resolved: false,
        outdated: true,
        path: "a.ts",
        line: 3,
        author: "reviewer",
        preview: "Please rename this one",
        comments: 2,
      },
    ]);
    expect(evidence.summary.headSha).toBe("head-sha-1");
  });

  it("asks for checks on the head commit it just read", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ headSha: "fresh-sha" })),
    });

    await read(github);

    expect(github.getPullRequestChecks).toHaveBeenCalledWith(
      repository,
      "fresh-sha",
    );
  });
});
