import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(
  () => [] as Array<{ path: string; signal?: AbortSignal }>,
);
const github = vi.hoisted(() => ({
  hang: false,
  failure: null as Error | null,
}));
vi.mock("./provider-api.js", () => ({
  executeGitHubSourceRequest: async (args: {
    path: string;
    signal?: AbortSignal;
  }) => {
    requests.push(args);
    if (github.failure) throw github.failure;
    if (github.hang) {
      // How the provider client reports a request its signal ended.
      await new Promise((_, reject) =>
        args.signal?.addEventListener("abort", () =>
          reject(new Error("Provider API request timed out after 30000ms")),
        ),
      );
    }
    return {
      response: {
        status: 200,
        ok: true,
        headers: {},
        json: { object: { sha: "c0ffee" }, tree: [] },
        truncated: false,
      },
    };
  },
}));

import {
  GitHubSourceDeadlineError,
  GitHubSourceError,
  readGitHubBlob,
  readGitHubBranchHead,
  readGitHubFolderTree,
} from "./github-source-client";

const target = { owner: "acme", repo: "site" };

beforeEach(() => {
  requests.length = 0;
  github.hang = false;
  github.failure = null;
});

describe("GitHub request paths", () => {
  it("keeps slashes in branch and folder names and encodes the rest", async () => {
    await readGitHubBranchHead({ ...target, branch: "release/2026 q4" });
    await readGitHubFolderTree({
      ...target,
      commitSha: "c0ffee",
      path: "docs/Getting Started",
    });
    expect(requests.map((request) => request.path)).toEqual([
      "/repos/acme/site/git/ref/heads/release/2026%20q4",
      "/repos/acme/site/git/trees/c0ffee%3Adocs/Getting%20Started?recursive=1",
    ]);
  });

  it("refuses dot and empty segments before asking GitHub", async () => {
    for (const branch of ["../../../user", "main/..", "a//b", "./main"]) {
      await expect(
        readGitHubBranchHead({ ...target, branch }),
      ).rejects.toMatchObject({ code: "branch_not_found" });
    }
    await expect(
      readGitHubFolderTree({ ...target, commitSha: "c0ffee", path: "docs/.." }),
    ).rejects.toBeInstanceOf(GitHubSourceError);
    expect(requests).toEqual([]);
  });
});

describe("GitHub request deadlines", () => {
  it("ends a request when the caller's time runs out", async () => {
    github.hang = true;
    const budget = new AbortController();
    const read = readGitHubBlob({
      ...target,
      sha: "b10b",
      signal: budget.signal,
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.signal).toBe(budget.signal);
    budget.abort();
    await expect(read).rejects.toBeInstanceOf(GitHubSourceDeadlineError);
  });

  it("keeps other failures as they are", async () => {
    github.failure = new Error("socket hang up");
    await expect(
      readGitHubBlob({
        ...target,
        sha: "b10b",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("socket hang up");
  });
});
