import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import { createGitHubClient } from "./github-client.js";

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
    .mockResolvedValue("github-test-token");
});

describe("GitHub triage client", () => {
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

    expect(pullRequests[0]).toMatchObject({
      number: 7,
      headSha: "sha-7",
      userId: 17,
    });
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
      if (path.endsWith("/comments"))
        return response(
          { id: 10, html_url: "https://github.test/comment/10" },
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

    await expect(client.listOpenIssues(repository)).resolves.toHaveLength(1);
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
    await expect(
      client.createIssueComment(repository, 2, "@builderio-bot please fix"),
    ).resolves.toEqual({
      id: 10,
      htmlUrl: "https://github.test/comment/10",
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

    mockedResolveConnectorSecret.mockResolvedValue("github-test-token");
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
      "/repos/builder/factory/pulls/7/comments",
      "/repos/builder/factory/commits/sha-7/check-runs",
    ]);
  });

  it("falls back to Actions workflow runs when Checks permission is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
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

  it("creates a GitHub issue for Sentry dispatch", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(
        "/repos/builder/factory/issues",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        title: "Sentry error",
        body: "@builderio-bot please fix",
      });
      return response(
        {
          number: 44,
          html_url: "https://github.test/issues/44",
        },
        201,
      );
    });
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl,
      }).createIssue(repository, {
        title: "Sentry error",
        body: "@builderio-bot please fix",
      }),
    ).resolves.toEqual({
      number: 44,
      htmlUrl: "https://github.test/issues/44",
    });
  });

  it("adds a GitHub issue reaction and treats an existing one as already present", async () => {
    const created = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(
        "/repos/builder/factory/issues/44/reactions",
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ content: "eyes" });
      return response({ id: 1 }, 201);
    });
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl: created,
      }).addIssueReaction(repository, 44, "eyes"),
    ).resolves.toEqual({ added: true, already_present: false });

    const already = vi.fn<typeof fetch>(
      async () => new Response("already reacted", { status: 422 }),
    );
    await expect(
      createGitHubClient({
        ownerEmail: "owner@example.com",
        fetchImpl: already,
      }).addIssueReaction(repository, 44, "eyes"),
    ).resolves.toEqual({ added: false, already_present: true });
  });
});
