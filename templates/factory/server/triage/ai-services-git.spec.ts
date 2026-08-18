import { describe, expect, it, vi } from "vitest";

import { createAiServicesGitReadClient } from "./ai-services-git.js";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ai-services Git read client", () => {
  it("uses the existing read endpoints and normalizes their results", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("detail")) {
        return response({
          pullRequest: {
            title: "Triage",
            body: "Review this",
            head: { sha: "sha-1" },
            htmlUrl: "https://github.com/a/b/pull/1",
            changedFiles: 1,
            additions: 4,
            deletions: 2,
          },
        });
      }
      if (path.endsWith("reviews")) {
        return response({
          reviews: [
            {
              user: { login: "reviewer" },
              state: "APPROVED",
              submittedAt: "2026-07-31T10:00:00.000Z",
              comments: [],
            },
          ],
        });
      }
      if (path.endsWith("checks")) {
        return response({
          checks: [
            {
              name: "ci",
              status: "completed",
              conclusion: "success",
              completedAt: "2026-07-31T10:00:00.000Z",
            },
          ],
        });
      }
      return response({
        files: [{ filename: "src/a.ts", additions: 4, deletions: 2 }],
      });
    });

    const snapshot = await createAiServicesGitReadClient({
      baseUrl: "https://ai-services.example.test/",
      authorization: "Bearer test-token",
      fetchImpl,
    }).fetchPullRequest({
      projectId: "project-1",
      repo: "a/b",
      pullRequestNumber: 1,
    });

    expect(snapshot).toMatchObject({
      repo: "a/b",
      pullRequestNumber: 1,
      headSha: "sha-1",
      changedFiles: ["src/a.ts"],
      diffLines: 6,
      coverage: "complete",
      comments: [],
      commentsTruncated: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("fails loudly when an ai-services read fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({}, 503));
    await expect(
      createAiServicesGitReadClient({
        baseUrl: "https://ai-services.example.test",
        authorization: "Bearer test-token",
        fetchImpl,
      }).fetchPullRequest({
        projectId: "project-1",
        repo: "a/b",
        pullRequestNumber: 1,
      }),
    ).rejects.toThrow("ai-services GitHub read failed");
  });

  it("maps review comments, keeping an absent inReplyToId null and a real id a string", async () => {
    const snapshot = await readWithReviews([
      {
        user: { login: "reviewer" },
        state: "COMMENTED",
        submittedAt: "2026-07-31T10:00:00.000Z",
        comments: [
          {
            id: 111,
            user: { login: "reviewer" },
            body: "please fix",
            path: "src/a.ts",
            line: 4,
            createdAt: "2026-07-31T10:00:00.000Z",
          },
          {
            id: 222,
            user: { login: "author" },
            inReplyToId: 111,
            body: "done",
            path: "src/a.ts",
            line: 4,
            createdAt: "2026-07-31T10:05:00.000Z",
          },
        ],
      },
    ]);

    expect(snapshot.commentsTruncated).toBe(false);
    expect(snapshot.comments).toEqual([
      {
        id: "111",
        author: "reviewer",
        inReplyToId: null,
        body: "please fix",
        path: "src/a.ts",
        line: 4,
        isResolved: undefined,
        createdAt: "2026-07-31T10:00:00.000Z",
      },
      {
        id: "222",
        author: "author",
        inReplyToId: "111",
        body: "done",
        path: "src/a.ts",
        line: 4,
        isResolved: undefined,
        createdAt: "2026-07-31T10:05:00.000Z",
      },
    ]);
  });

  it("passes isResolved through unchanged and leaves an absent one undefined", async () => {
    const snapshot = await readWithReviews([
      {
        user: { login: "reviewer" },
        state: "COMMENTED",
        submittedAt: "2026-07-31T10:00:00.000Z",
        comments: [
          { ...commentPayload(1), isResolved: true },
          { ...commentPayload(2), isResolved: false },
          commentPayload(3),
        ],
      },
    ]);

    expect(snapshot.comments.map((c) => c.isResolved)).toEqual([
      true,
      false,
      undefined,
    ]);
  });

  it("flattens comments across reviews and flags a full upstream page as truncated", async () => {
    const snapshot = await readWithReviews([
      {
        user: { login: "reviewer" },
        state: "COMMENTED",
        submittedAt: "2026-07-31T10:00:00.000Z",
        comments: Array.from({ length: 60 }, (_, index) =>
          commentPayload(index + 1),
        ),
      },
      {
        user: { login: "other" },
        state: "COMMENTED",
        submittedAt: "2026-07-31T10:00:00.000Z",
        comments: Array.from({ length: 40 }, (_, index) =>
          commentPayload(index + 61),
        ),
      },
    ]);

    expect(snapshot.comments).toHaveLength(100);
    expect(snapshot.commentsTruncated).toBe(true);
  });
});

function commentPayload(id: number) {
  return {
    id,
    user: { login: "reviewer" },
    body: "please fix",
    path: "src/a.ts",
    line: 4,
    createdAt: "2026-07-31T10:00:00.000Z",
  };
}

function readWithReviews(reviews: unknown[]) {
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("detail")) {
      return response({
        pullRequest: {
          title: "Triage",
          body: "Review this",
          head: { sha: "sha-1" },
          htmlUrl: "https://github.com/a/b/pull/1",
          changedFiles: 1,
          additions: 4,
          deletions: 2,
        },
      });
    }
    if (path.endsWith("reviews")) return response({ reviews });
    if (path.endsWith("checks")) return response({ checks: [] });
    return response({ files: [] });
  });

  return createAiServicesGitReadClient({
    baseUrl: "https://ai-services.example.test",
    authorization: "Bearer test-token",
    fetchImpl,
  }).fetchPullRequest({
    projectId: "project-1",
    repo: "a/b",
    pullRequestNumber: 1,
  });
}
