import { describe, expect, it } from "vitest";

import {
  githubPullRequestDaysOpen,
  githubPullRequestKey,
  githubPullRequestSearchQuery,
  githubPullRequestsSourceName,
  githubPullRequestValues,
  parseGitHubPullRequestUrl,
  type GitHubPullRequestRecord,
} from "./github-pull-requests";

describe("parseGitHubPullRequestUrl", () => {
  it("reads a pull request link with or without a trailing path", () => {
    expect(
      parseGitHubPullRequestUrl("https://github.com/acme/site/pull/12"),
    ).toEqual({ owner: "acme", repo: "site", number: 12 });
    expect(
      parseGitHubPullRequestUrl(
        "https://github.com/acme/site/pull/12/files?diff=split#top",
      ),
    ).toEqual({ owner: "acme", repo: "site", number: 12 });
    expect(parseGitHubPullRequestUrl("github.com/acme/site/pull/3")).toEqual({
      owner: "acme",
      repo: "site",
      number: 3,
    });
  });

  it("reads the short owner/repo#number form", () => {
    expect(parseGitHubPullRequestUrl(" acme/site.js#7 ")).toEqual({
      owner: "acme",
      repo: "site.js",
      number: 7,
    });
  });

  it("refuses anything that isn't a pull request", () => {
    for (const input of [
      "https://github.com/acme/site/issues/12",
      "https://github.com/acme/site",
      "https://gitlab.com/acme/site/pull/12",
      "https://github.com/acme/site/pull/0",
      "https://github.com/acme/site/pull/12abc",
      "acme/site#",
      "not a link",
    ]) {
      expect(parseGitHubPullRequestUrl(input), input).toBeNull();
    }
  });
});

describe("githubPullRequestKey", () => {
  it("is case-blind on owner and repository, as GitHub is", () => {
    expect(
      githubPullRequestKey({ owner: "ACME", repo: "Site", number: 4 }),
    ).toBe(githubPullRequestKey({ owner: "acme", repo: "site", number: 4 }));
  });
});

describe("githubPullRequestSearchQuery", () => {
  it("asks for pull requests unless the search already does", () => {
    expect(githubPullRequestSearchQuery("is:open  author:@me")).toBe(
      "is:pr is:open author:@me",
    );
    expect(githubPullRequestSearchQuery("type:pr repo:acme/site")).toBe(
      "type:pr repo:acme/site",
    );
    expect(githubPullRequestSearchQuery("is:pr is:open")).toBe("is:pr is:open");
  });
});

describe("githubPullRequestsSourceName", () => {
  it("names the search, or says the rows come only from links", () => {
    expect(githubPullRequestsSourceName("is:open author:@me")).toBe(
      "GitHub pull requests: is:open author:@me",
    );
    expect(githubPullRequestsSourceName(null)).toBe(
      "GitHub pull requests added by link",
    );
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-14T12:00:00Z");

function record(
  change: Partial<GitHubPullRequestRecord> = {},
): GitHubPullRequestRecord {
  return {
    owner: "acme",
    repo: "site",
    number: 9,
    title: "Fix the header",
    url: "https://github.com/acme/site/pull/9",
    author: "octocat",
    state: "open",
    draft: false,
    review: "approved",
    checks: "passing",
    createdAt: new Date(NOW - 5.5 * DAY_MS).toISOString(),
    updatedAt: "2026-11-13T23:30:00Z",
    closedAt: null,
    ...change,
  };
}

describe("githubPullRequestValues", () => {
  it("gives an open pull request's columns", () => {
    expect(githubPullRequestValues(record(), NOW)).toEqual({
      repository: "acme/site",
      number: 9,
      author: "octocat",
      state: "Open",
      review: "Approved",
      checks: "Passing",
      checksFailing: null,
      opened: { start: "2026-11-09" },
      updated: { start: "2026-11-13" },
      closed: null,
      daysOpen: 5,
      link: "https://github.com/acme/site/pull/9",
    });
  });

  it("shows drafts as Draft and ticks Checks failing only when they fail", () => {
    const values = githubPullRequestValues(
      record({ draft: true, checks: "failing", review: "changes_requested" }),
      NOW,
    );
    expect(values).toMatchObject({
      state: "Draft",
      review: "Changes requested",
      checks: "Failing",
      checksFailing: true,
    });
  });

  it("leaves Days open empty once a pull request closes", () => {
    const merged = record({
      state: "merged",
      closedAt: "2026-11-12T08:00:00Z",
    });
    expect(githubPullRequestValues(merged, NOW)).toMatchObject({
      state: "Merged",
      closed: { start: "2026-11-12" },
      daysOpen: null,
    });
    expect(githubPullRequestDaysOpen(merged, NOW)).toBeNull();
    expect(
      githubPullRequestDaysOpen(record({ state: "closed" }), NOW),
    ).toBeNull();
  });
});
