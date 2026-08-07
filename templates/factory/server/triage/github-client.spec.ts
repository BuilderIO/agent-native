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
          user: { login: "author" },
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

    expect(pullRequests[0]).toMatchObject({ number: 7, headSha: "sha-7" });
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
            user: { login: "author" },
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
            user: { login: "author" },
            labels: [],
            created_at: "now",
            updated_at: "now",
          },
        ]);
      }
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
      client.approvePullRequest(repository, 2),
    ).resolves.toMatchObject({ id: 9, state: "APPROVED" });
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
});
