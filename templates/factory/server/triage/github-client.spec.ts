import { generateKeyPairSync } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  GitHubMergeNotCompletedError,
  createGitHubClient,
  reviewCommentsFromGraphqlThreads,
} from "./github-client.js";

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: vi.fn(),
}));

const mockedResolveConnectorSecret = vi.mocked(resolveConnectorSecret);

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

const repository = { owner: "builder", repo: "factory" };

beforeEach(() => {
  mockedResolveConnectorSecret
    .mockReset()
    .mockImplementation(async (key) =>
      key === "GITHUB_TOKEN" ? "github-test-token" : undefined,
    );
});

describe("GitHub triage client", () => {
  it("exchanges and reuses a GitHub App installation token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    mockedResolveConnectorSecret.mockImplementation(
      async (key) =>
        ({
          GITHUB_APP_ID: "123",
          GITHUB_APP_INSTALLATION_ID: "456",
          GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
        })[key],
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/access_tokens")) {
        return response({
          token: "installation-token",
          expires_at: "2099-01-01T00:00:00Z",
        });
      }
      return response([]);
    });
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    });
    await client.listOpenIssues(repository);
    await client.listOpenIssues(repository);
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        String(input).includes("/access_tokens"),
      ),
    ).toHaveLength(1);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer installation-token",
      }),
    });
  });

  it("resolves the GitHub App bot actor for authenticated identity checks", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    mockedResolveConnectorSecret.mockImplementation(
      async (key) =>
        ({
          GITHUB_APP_ID: "123",
          GITHUB_APP_INSTALLATION_ID: "456",
          GITHUB_APP_PRIVATE_KEY: pem,
        })[key],
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/access_tokens")) {
        return response({
          token: "installation-token",
          expires_at: "2099-01-01T00:00:00Z",
        });
      }
      if (path === "/app") return response({ slug: "agent-native-factory" });
      if (path.includes("/users/agent-native-factory")) {
        return response({ login: "agent-native-factory[bot]", id: 323 });
      }
      throw new Error(`unexpected ${path}`);
    });

    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl,
      }).getAuthenticatedUser(),
    ).resolves.toEqual({ login: "agent-native-factory[bot]", id: 323 });
  });

  it("rejects incomplete GitHub App configuration without exposing key material", async () => {
    mockedResolveConnectorSecret.mockImplementation(async (key) =>
      key === "GITHUB_APP_ID" ? "123" : undefined,
    );
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl: vi.fn<typeof fetch>(),
      }).listOpenIssues(repository),
    ).rejects.toThrow("GitHub App configuration is incomplete");
  });

  it("counts pull requests the issues endpoint returned instead of hiding them", async () => {
    const issue = (number: number, extra: Record<string, unknown> = {}) => ({
      number,
      title: `Item ${number}`,
      body: null,
      state: "open",
      html_url: `https://github.test/issues/${number}`,
      user: { id: 17, login: "author" },
      labels: [],
      created_at: "now",
      updated_at: "now",
      ...extra,
    });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response([
        issue(1),
        issue(2, { pull_request: { url: "https://api.github.test/pulls/2" } }),
        issue(3, { pull_request: { url: "https://api.github.test/pulls/3" } }),
      ]),
    );
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    });

    await expect(client.listOpenIssues(repository, 3)).resolves.toMatchObject({
      items: [expect.objectContaining({ number: 1 })],
      unparsed: 2,
      hasMore: true,
    });
  });

  it("resolves the workspace token and bounds open reads", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response([
        {
          number: 7,
          title: "Fix",
          body: null,
          state: "open",
          draft: false,
          html_url: "https://github.test/pull/7",
          user: { id: 17, login: "author" },
          head: { sha: "sha-7", ref: "fix" },
          base: { ref: "main" },
          created_at: "2026-08-04T00:00:00Z",
          updated_at: "2026-08-04T00:00:00Z",
        },
      ]),
    );

    const pullRequests = await createGitHubClient({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      fetchImpl,
    }).listOpenPullRequests(repository);

    expect(pullRequests.items[0]).toMatchObject({
      number: 7,
      headSha: "sha-7",
      userId: 17,
    });
    expect(pullRequests.hasMore).toBe(false);
    expect(
      new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get(
        "per_page",
      ),
    ).toBe("100");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer github-test-token" },
    });
    expect(mockedResolveConnectorSecret).toHaveBeenCalledWith(
      "GITHUB_TOKEN",
      "owner@example.com",
      { orgId: "org-1" },
    );
  });

  it("filters pull requests from issue intake and supports member, approval, and merge helpers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/issues")) {
        return response([
          {
            number: 1,
            title: "Issue",
            body: "body",
            state: "open",
            html_url: "https://github.test/issues/1",
            user: { login: "author", id: 1 },
            labels: [],
            created_at: "now",
            updated_at: "now",
          },
          {
            number: 2,
            title: "PR",
            pull_request: {},
            body: "body",
            state: "open",
            html_url: "https://github.test/pulls/2",
            user: { login: "author", id: 1 },
            labels: [],
            created_at: "now",
            updated_at: "now",
          },
        ]);
      }
      if (path === "/users/reviewer")
        return response({ id: 17, login: "reviewer" });
      if (path.endsWith("/permission")) return response({ permission: "push" });
      if (path.includes("/orgs/")) return emptyResponse(204);
      if (path.endsWith("/reviews"))
        return response(
          {
            id: 9,
            state: "APPROVED",
            html_url: "https://github.test/review/9",
          },
          201,
        );
      if (path.endsWith("/merge"))
        return response({ sha: "merge-sha", merged: true, message: "Merged" });
      throw new Error(`unexpected ${path} ${init?.method ?? "GET"}`);
    });
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    });

    await expect(client.listOpenIssues(repository)).resolves.toMatchObject({
      items: [expect.anything()],
    });
    await expect(client.checkMember(repository, "reviewer")).resolves.toEqual({
      username: "reviewer",
      isMember: true,
      permission: "push",
    });
    await expect(
      client.checkOrganizationMember("BuilderIO", "reviewer"),
    ).resolves.toEqual({
      username: "reviewer",
      isMember: true,
      permission: null,
    });
    await expect(
      client.checkOrganizationMemberById("BuilderIO", 17, "reviewer"),
    ).resolves.toEqual({
      username: "reviewer",
      isMember: true,
      permission: null,
    });
    await expect(
      client.approvePullRequest(repository, 2, "Factory approval", "head-sha"),
    ).resolves.toMatchObject({ id: 9, state: "APPROVED" });
    const approvalRequest = fetchImpl.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith("/reviews"),
    );
    expect(JSON.parse(String(approvalRequest?.[1]?.body))).toMatchObject({
      event: "APPROVE",
      body: "Factory approval",
      commit_id: "head-sha",
    });
    await expect(client.mergePullRequest(repository, 2)).resolves.toEqual({
      sha: "merge-sha",
      merged: true,
      message: "Merged",
    });
    await client.mergePullRequest(repository, 2, "Merge fix", "head-sha");
    const mergeRequests = fetchImpl.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.endsWith("/merge"),
    );
    const mergeRequest = mergeRequests[mergeRequests.length - 1];
    expect(JSON.parse(String(mergeRequest?.[1]?.body))).toEqual({
      commit_message: "Merge fix",
      sha: "head-sha",
    });
  });

  it("does not turn a missing credential or failed merge into success", async () => {
    mockedResolveConnectorSecret.mockResolvedValue(undefined);
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(),
    });
    await expect(client.listOpenIssues(repository)).rejects.toThrow(
      "GITHUB_TOKEN is not configured",
    );

    mockedResolveConnectorSecret.mockImplementation(async (key) =>
      key === "GITHUB_TOKEN" ? "github-test-token" : undefined,
    );
    const failedFetch = vi.fn<typeof fetch>(async () =>
      response({ merged: false, message: "not clean" }),
    );
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl: failedFetch,
      }).mergePullRequest(repository, 2),
    ).rejects.toThrow("not clean");
  });

  it("reads review comments, reviews, and check runs from GitHub", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (path === "/graphql") {
        return response({});
      }
      if (path.endsWith("/reviews")) {
        return response([
          {
            user: { login: "reviewer", id: 2 },
            state: "CHANGES_REQUESTED",
            submitted_at: "2026-08-28T12:00:00Z",
          },
        ]);
      }
      if (path.endsWith("/comments")) {
        return response([
          {
            id: 11,
            user: { login: "reviewer", id: 2 },
            body: "Please fix",
            path: "src/a.ts",
            line: 4,
            in_reply_to_id: null,
            created_at: "2026-08-28T12:00:00Z",
          },
          {
            id: 12,
            user: { login: "author", id: 1 },
            body: "Fixed",
            in_reply_to_id: 11,
            created_at: "2026-08-28T12:01:00Z",
          },
        ]);
      }
      if (path.endsWith("/check-runs")) {
        return response({
          total_count: 1,
          check_runs: [
            {
              name: "ci",
              status: "completed",
              conclusion: "success",
              completed_at: "2026-08-28T12:02:00Z",
            },
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const evidence = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).getPullRequestEvidence(repository, 7, "sha-7");

    expect(evidence.comments).toEqual([
      {
        id: "11",
        author: "reviewer",
        inReplyToId: null,
        body: "Please fix",
        path: "src/a.ts",
        line: 4,
        createdAt: "2026-08-28T12:00:00Z",
      },
      {
        id: "12",
        author: "author",
        inReplyToId: "11",
        body: "Fixed",
        createdAt: "2026-08-28T12:01:00Z",
      },
    ]);
    expect(evidence.commentsTruncated).toBe(false);
    expect(evidence.reviewsTruncated).toBe(false);
    expect(evidence.reviews).toEqual([
      {
        author: "reviewer",
        state: "changes_requested",
        observedAt: "2026-08-28T12:00:00Z",
      },
    ]);
    expect(evidence.checks).toEqual([
      {
        name: "ci",
        state: "passed",
        observedAt: "2026-08-28T12:02:00Z",
      },
    ]);
    expect(evidence.checksCoverage).toBe("complete");
    const paths = fetchImpl.mock.calls.map(
      ([input]) => new URL(String(input)).pathname,
    );
    expect(paths).toEqual([
      "/repos/builder/factory/pulls/7/reviews",
      "/graphql",
      "/repos/builder/factory/pulls/7/comments",
      "/repos/builder/factory/commits/sha-7/check-runs",
    ]);
    expect(
      new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("page"),
    ).toBe("1");
  });

  it("pages review submissions and flags an incomplete last page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (path.endsWith("/reviews")) {
        const page = url.searchParams.get("page");
        if (page === "1") {
          return response(
            Array.from({ length: 100 }, (_, index) => ({
              user: { login: "reviewer", id: 2 },
              state: "COMMENTED",
              body: `note ${index}`,
              submitted_at: "2026-08-28T12:00:00Z",
            })),
          );
        }
        if (page === "2") {
          return response([
            {
              user: { login: "reviewer", id: 2 },
              state: "COMMENTED",
              body: "later feedback",
              submitted_at: "2026-08-28T13:00:00Z",
            },
          ]);
        }
        throw new Error(`unexpected review page ${page}`);
      }
      if (path.endsWith("/comments")) return response([]);
      if (path.endsWith("/check-runs")) {
        return response({
          total_count: 1,
          check_runs: [
            {
              name: "ci",
              status: "completed",
              conclusion: "success",
              completed_at: "2026-08-28T12:02:00Z",
            },
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const evidence = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).getPullRequestEvidence(repository, 7, "sha-7");

    expect(evidence.reviews).toHaveLength(101);
    expect(evidence.reviews[evidence.reviews.length - 1]?.body).toBe(
      "later feedback",
    );
    expect(evidence.reviewsTruncated).toBe(false);
  });

  it("reads each review's commit and the reviewer's association and type from every page, so an approval after the first 100 reviews is seen", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      if (!url.pathname.endsWith("/reviews")) {
        throw new Error(`unexpected ${url.pathname}`);
      }
      if (page === "1") {
        return response(
          Array.from({ length: 100 }, (_, index) => ({
            user: {
              login: `commenter-${index}`,
              id: 100 + index,
              type: index === 0 ? "Bot" : "User",
            },
            state: "COMMENTED",
            author_association: "NONE",
            commit_id: "sha-6",
            submitted_at: "2026-08-28T12:00:00Z",
          })),
        );
      }
      if (page === "2") {
        return response([
          {
            user: { login: "maintainer", id: 2, type: "User" },
            state: "APPROVED",
            author_association: "MEMBER",
            commit_id: "sha-7",
            html_url: "https://github.example.test/review/1",
            submitted_at: "2026-08-28T13:00:00Z",
          },
          {
            user: { login: "ghost", id: 3 },
            state: "APPROVED",
            submitted_at: "2026-08-28T13:01:00Z",
          },
        ]);
      }
      throw new Error(`unexpected review page ${page}`);
    });

    const { reviews, reviewsTruncated } = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).listPullRequestReviews(repository, 7);

    expect(reviewsTruncated).toBe(false);
    expect(reviews).toHaveLength(102);
    expect(reviews[0]).toMatchObject({
      state: "commented",
      authorAssociation: "NONE",
      authorType: "Bot",
      commitSha: "sha-6",
    });
    expect(reviews[100]).toEqual({
      author: "maintainer",
      state: "approved",
      authorAssociation: "MEMBER",
      authorType: "User",
      commitSha: "sha-7",
      htmlUrl: "https://github.example.test/review/1",
      observedAt: "2026-08-28T13:00:00Z",
    });
    // A review GitHub gives no association for is passed on without one, never with a made-up value.
    expect(reviews[101]).not.toHaveProperty("authorAssociation");
    expect(reviews[101]).not.toHaveProperty("authorType");
    expect(reviews[101]).not.toHaveProperty("commitSha");
  });

  it("preserves GraphQL completeness when a full page has exactly 100 comments", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/graphql") {
        return response({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false },
                  nodes: Array.from({ length: 100 }, (_, index) => ({
                    id: `PRRT_${index}`,
                    isResolved: false,
                    isOutdated: false,
                    comments: {
                      pageInfo: { hasNextPage: false },
                      nodes: [
                        {
                          databaseId: index + 1,
                          body: `comment ${index}`,
                          createdAt: "2026-08-28T12:00:00Z",
                          author: { login: "reviewer" },
                        },
                      ],
                    },
                  })),
                },
              },
            },
          },
        });
      }
      if (path.endsWith("/reviews") || path.endsWith("/comments")) {
        return response([]);
      }
      if (path.endsWith("/check-runs")) {
        return response({
          total_count: 1,
          check_runs: [
            {
              name: "ci",
              status: "completed",
              conclusion: "success",
              completed_at: "2026-08-28T12:02:00Z",
            },
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const evidence = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).getPullRequestEvidence(repository, 7, "sha-7");

    expect(evidence.comments).toHaveLength(100);
    expect(evidence.commentsTruncated).toBe(false);
  });

  it("falls back to Actions workflow runs when Checks permission is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/graphql") {
        return response({});
      }
      if (path.endsWith("/reviews") || path.endsWith("/comments")) {
        return response([]);
      }
      if (path.endsWith("/check-runs")) {
        return response(
          { message: "Resource not accessible by personal access token" },
          403,
        );
      }
      if (path.endsWith("/actions/runs")) {
        return response({
          total_count: 1,
          workflow_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              created_at: "2026-08-28T12:00:00Z",
              updated_at: "2026-08-28T12:02:00Z",
            },
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const evidence = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).getPullRequestEvidence(repository, 7, "sha-7");

    expect(evidence.checks).toEqual([
      {
        name: "CI",
        state: "passed",
        observedAt: "2026-08-28T12:02:00Z",
      },
    ]);
    expect(evidence.checksCoverage).toBe("partial");
    expect(
      fetchImpl.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual([
      "/repos/builder/factory/pulls/7/reviews",
      "/graphql",
      "/repos/builder/factory/pulls/7/comments",
      "/repos/builder/factory/commits/sha-7/check-runs",
      "/repos/builder/factory/actions/runs",
    ]);
    const workflowRequest = fetchImpl.mock.calls.find(([input]) =>
      new URL(String(input)).pathname.endsWith("/actions/runs"),
    );
    expect(new URL(String(workflowRequest?.[0])).searchParams).toEqual(
      new URLSearchParams({ head_sha: "sha-7", per_page: "100" }),
    );
  });

  it("lists review comments without fetching reviews or check runs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/comments")) {
        return response([
          {
            id: 11,
            user: { login: "reviewer", id: 2 },
            body: "",
            in_reply_to_id: null,
            created_at: "2026-08-28T12:00:00Z",
          },
        ]);
      }
      throw new Error(`unexpected ${path}`);
    });

    const snapshot = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).listPullRequestReviewComments(repository, 7);

    expect(snapshot.comments).toEqual([
      {
        id: "11",
        author: "reviewer",
        inReplyToId: null,
        body: "",
        createdAt: "2026-08-28T12:00:00Z",
      },
    ]);
    expect(snapshot.commentsTruncated).toBe(false);
  });

  it("lists issue comments across pages and reports a readable scan", async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: start + index,
        user: { login: "builderio-bot", id: 9 },
        body: `comment ${start + index}`,
        created_at: "2026-08-28T12:00:00Z",
        html_url: `https://github.com/builder/factory/pull/7#c${start + index}`,
      }));
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/issues/7/comments")) {
        throw new Error(`unexpected ${url.pathname}`);
      }
      return response(
        url.searchParams.get("page") === "1" ? page(1, 100) : page(101, 3),
      );
    });

    const scan = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).listIssueComments(repository, 7);

    expect(scan.comments).toHaveLength(103);
    expect(scan.truncated).toBe(false);
    expect(scan.comments[0]).toEqual({
      id: "1",
      author: "builderio-bot",
      body: "comment 1",
      createdAt: "2026-08-28T12:00:00Z",
      htmlUrl: "https://github.com/builder/factory/pull/7#c1",
    });
  });

  it("marks an issue comment scan truncated when every page is full", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      user: { login: "reviewer", id: 2 },
      body: "chatter",
      created_at: "2026-08-28T12:00:00Z",
      html_url: `https://github.com/builder/factory/pull/7#c${index + 1}`,
    }));
    const fetchImpl = vi.fn<typeof fetch>(async () => response(full));

    const scan = await createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    }).listIssueComments(repository, 7);

    expect(scan.truncated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("refuses an issue comment whose body is not a string", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response([
        {
          id: 5,
          user: { login: "reviewer", id: 2 },
          body: null,
          created_at: "2026-08-28T12:00:00Z",
          html_url: "https://github.com/builder/factory/pull/7#c5",
        },
      ]),
    );

    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl,
      }).listIssueComments(repository, 7),
    ).rejects.toThrow("issue comment body");
  });

  it("fails loudly when GitHub check-run results are truncated", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/reviews") || path.endsWith("/comments")) {
        return response([]);
      }
      return response({
        total_count: 2,
        check_runs: [
          {
            name: "ci",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-28T12:02:00Z",
          },
        ],
      });
    });

    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl,
      }).getPullRequestEvidence(repository, 7, "sha-7"),
    ).rejects.toThrow("check-run page was truncated");
  });

  it("lists pull-request filenames and fails when the file page is truncated", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response([{ filename: "src/a.ts" }, { filename: "src/b.ts" }]),
    );
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl,
      }).listPullRequestChangedFiles(repository, 7),
    ).resolves.toEqual(["src/a.ts", "src/b.ts"]);

    const truncated = vi.fn<typeof fetch>(async () =>
      response(
        Array.from({ length: 100 }, (_, index) => ({
          filename: `src/${index}.ts`,
        })),
      ),
    );
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl: truncated,
      }).listPullRequestChangedFiles(repository, 7),
    ).rejects.toThrow("file page was truncated");
  });

  it("rejects GraphQL payloads with top-level errors", () => {
    expect(
      reviewCommentsFromGraphqlThreads({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false },
                nodes: [],
              },
            },
          },
        },
        errors: [{ message: "Could not resolve review thread" }],
      }),
    ).toBeNull();
  });

  it("maps GraphQL review threads into flat comments with thread flags", () => {
    const parsed = reviewCommentsFromGraphqlThreads({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  id: "PRRT_kwDOABC",
                  isResolved: false,
                  isOutdated: true,
                  comments: {
                    pageInfo: { hasNextPage: false },
                    nodes: [
                      {
                        databaseId: 123,
                        body: "please fix",
                        createdAt: "2026-09-14T18:00:00.000Z",
                        path: "src/a.ts",
                        line: 10,
                        author: { login: "builder-io-integration[bot]" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    });
    expect(parsed?.comments).toHaveLength(1);
    expect(parsed?.comments[0]).toMatchObject({
      id: "123",
      isOutdated: true,
      isResolved: false,
      threadId: "PRRT_kwDOABC",
    });
  });
});

describe("GitHub client reads and merges for workflows", () => {
  const checkRun = {
    name: "ci",
    status: "completed",
    conclusion: "success",
    completed_at: "2026-08-28T12:02:00Z",
  };

  it("reads the checks on a head commit, and says when it could only see workflow runs", async () => {
    const complete = vi.fn<typeof fetch>(async () =>
      response({ total_count: 1, check_runs: [checkRun] }),
    );
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: complete,
    });

    await expect(
      client.getPullRequestChecks(repository, "sha-7"),
    ).resolves.toEqual({
      checks: [
        { name: "ci", state: "passed", observedAt: "2026-08-28T12:02:00Z" },
      ],
      checksCoverage: "complete",
    });
    expect(new URL(String(complete.mock.calls[0]?.[0])).pathname).toBe(
      "/repos/builder/factory/commits/sha-7/check-runs",
    );

    const fallback = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.endsWith("/check-runs")
        ? response(
            { message: "Resource not accessible by personal access token" },
            403,
          )
        : response({
            total_count: 1,
            workflow_runs: [
              {
                name: "CI",
                status: "completed",
                conclusion: "success",
                updated_at: "2026-08-28T12:03:00Z",
              },
            ],
          }),
    );
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl: fallback,
      }).getPullRequestChecks(repository, "sha-7"),
    ).resolves.toMatchObject({ checksCoverage: "partial" });
  });

  it("refuses to call a truncated check list complete", async () => {
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response({ total_count: 150, check_runs: [checkRun] }),
      ),
    });

    await expect(
      client.getPullRequestChecks(repository, "sha-7"),
    ).rejects.toThrow("cannot treat CI as complete");
  });

  it("reads which merge methods the repository allows", async () => {
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response({
          allow_merge_commit: false,
          allow_squash_merge: true,
          allow_rebase_merge: false,
        }),
      ),
    });

    await expect(
      client.getRepositoryMergeSettings(repository),
    ).resolves.toEqual({
      allowMergeCommit: false,
      allowSquashMerge: true,
      allowRebaseMerge: false,
    });
  });

  it("does not read a missing merge setting as false", async () => {
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response({ allow_squash_merge: true }),
      ),
    });

    await expect(client.getRepositoryMergeSettings(repository)).rejects.toThrow(
      "missing repository merge-commit setting",
    );
  });

  it("pins the merge to a head sha and sends the chosen method", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response({ merged: true, sha: "merge-sha", message: "Merged" }),
    );
    const client = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl,
    });

    await client.mergePullRequest(
      repository,
      2,
      undefined,
      "head-sha",
      "rebase",
    );

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      sha: "head-sha",
      merge_method: "rebase",
    });
  });

  it("raises a typed error when GitHub answers merged: false, and keeps the pull request's merge commit", async () => {
    const refused = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response({ merged: false, message: "not clean" }),
      ),
    });
    await expect(
      refused.mergePullRequest(repository, 2),
    ).rejects.toBeInstanceOf(GitHubMergeNotCompletedError);

    const summary = createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        response({
          number: 7,
          title: "t",
          body: null,
          state: "closed",
          draft: false,
          merged: true,
          merged_at: "2026-08-28T12:00:00Z",
          merge_commit_sha: "merge-commit-sha",
          html_url: "https://github.test/pr/7",
          user: { id: 1, login: "builder-io-integration[bot]" },
          head: { sha: "h", ref: "r", repo: { full_name: "acme/app" } },
          base: {
            ref: "main",
            repo: { full_name: "acme/app", default_branch: "main" },
          },
          created_at: "2026-08-28T10:00:00Z",
          updated_at: "2026-08-28T12:00:00Z",
          additions: 1,
          deletions: 1,
          changed_files: 1,
          mergeable: null,
          mergeable_state: null,
          review_comments: 0,
        }),
      ),
    });
    await expect(
      summary.getPullRequestSummary(repository, 7),
    ).resolves.toMatchObject({
      merged: true,
      mergeCommitSha: "merge-commit-sha",
    });
  });
});

describe("getPullRequestSummary: where the pull request comes from", () => {
  const payload = (head: unknown, base: unknown) => ({
    number: 7,
    title: "t",
    body: null,
    state: "open",
    draft: false,
    html_url: "https://github.test/pr/7",
    user: { id: 1, login: "builder-io-integration[bot]" },
    head: { sha: "h", ref: "r", repo: head },
    base: { ref: "main", repo: base },
    created_at: "2026-08-28T10:00:00Z",
    updated_at: "2026-08-28T12:00:00Z",
    additions: 1,
    deletions: 1,
    changed_files: 1,
    mergeable: true,
    mergeable_state: "clean",
    review_comments: 0,
  });
  const summaryOf = (body: unknown) =>
    createGitHubClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () => response(body)),
    }).getPullRequestSummary(repository, 7);
  const base = { full_name: "acme/app", default_branch: "trunk" };

  it("reads the head and base repositories and the base's default branch from the pull request itself", async () => {
    await expect(
      summaryOf(payload({ full_name: "someone/app" }, base)),
    ).resolves.toMatchObject({
      headRepository: "someone/app",
      baseRepository: "acme/app",
      baseDefaultBranch: "trunk",
    });
  });

  it("reads a deleted fork as no head repository, and an unreadable answer as an error", async () => {
    await expect(summaryOf(payload(null, base))).resolves.toMatchObject({
      headRepository: null,
    });
    await expect(summaryOf(payload(undefined, base))).rejects.toThrow(
      /not an object/,
    );
    await expect(
      summaryOf(payload({ full_name: "acme/app" }, { full_name: "acme/app" })),
    ).rejects.toThrow(/base default branch/);
  });
});
