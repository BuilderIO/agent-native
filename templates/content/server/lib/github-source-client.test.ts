import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(
  () => [] as Array<{ path: string; signal?: AbortSignal }>,
);
const github = vi.hoisted(() => ({
  hang: false,
  failure: null as Error | null,
  /** What GitHub answers instead of an empty folder, when set. */
  response: null as null | { status: number; json: unknown },
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
    const status = github.response?.status ?? 200;
    return {
      response: {
        status,
        ok: status < 400,
        headers: {},
        json: github.response?.json ?? {
          object: { sha: "c0ffee" },
          tree: [],
        },
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
  readGitHubRenames,
} from "./github-source-client";

const target = { owner: "acme", repo: "site" };

beforeEach(() => {
  requests.length = 0;
  github.hang = false;
  github.failure = null;
  github.response = null;
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

describe("GitHub responses", () => {
  it("fails a folder listing that comes back without its files", async () => {
    github.response = { status: 200, json: { sha: "c0ffee" } };
    await expect(
      readGitHubFolderTree({ ...target, commitSha: "c0ffee", path: "docs" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("reads renames from the comparison's first page, which lists every file", async () => {
    github.response = {
      status: 200,
      json: {
        files: [
          {
            status: "renamed",
            filename: "docs/help/faq.md",
            previous_filename: "docs/faq.md",
          },
          { status: "modified", filename: "docs/guide.md" },
        ],
      },
    };
    await expect(
      readGitHubRenames({ ...target, base: "a1", head: "b2" }),
    ).resolves.toEqual([{ from: "docs/faq.md", to: "docs/help/faq.md" }]);
    expect(requests.map((request) => request.path)).toEqual([
      "/repos/acme/site/compare/a1...b2?per_page=1",
    ]);
  });

  it("gives up on renames only when the comparison can't be made", async () => {
    github.response = { status: 404, json: { message: "No commit found" } };
    await expect(
      readGitHubRenames({ ...target, base: "a1", head: "b2" }),
    ).resolves.toBeNull();
    for (const [status, code] of [
      [403, "rate_limited"],
      [500, "unavailable"],
    ] as const) {
      github.response = {
        status,
        json: { message: status === 403 ? "API rate limit exceeded" : "" },
      };
      await expect(
        readGitHubRenames({ ...target, base: "a1", head: "b2" }),
      ).rejects.toMatchObject({ code });
    }
  });
});
