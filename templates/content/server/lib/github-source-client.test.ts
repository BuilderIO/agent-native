import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(
  () => [] as Array<{ path: string; signal?: AbortSignal }>,
);
const github = vi.hoisted(() => ({
  hang: false,
  /** Holds requests past their signal, as the client's rate-limit queue can. */
  stall: false,
  /** Requests to end as if another caller's signal ended a shared read. */
  endedElsewhere: 0,
  failure: null as Error | null,
  /** What GitHub answers instead of an empty folder, when set. */
  response: null as null | { status: number; json: unknown },
  /** How the provider client reports a request a signal ended. */
  timedOut: () =>
    Object.assign(new Error("Provider API request timed out after 30000ms"), {
      cause: new DOMException("This operation was aborted", "AbortError"),
    }),
}));
vi.mock("./provider-api.js", () => ({
  executeGitHubSourceRequest: async (args: {
    path: string;
    signal?: AbortSignal;
  }) => {
    requests.push(args);
    if (github.failure) throw github.failure;
    if (github.stall) await new Promise(() => {});
    if (github.endedElsewhere > 0) {
      github.endedElsewhere -= 1;
      throw github.timedOut();
    }
    if (github.hang) {
      await new Promise((_, reject) =>
        args.signal?.addEventListener("abort", () => reject(github.timedOut())),
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
  github.stall = false;
  github.endedElsewhere = 0;
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
    expect(requests).toHaveLength(1);
  });

  it("stops waiting at its own deadline while the provider client holds the request", async () => {
    github.stall = true;
    const budget = new AbortController();
    const read = readGitHubBlob({
      ...target,
      sha: "b10b",
      signal: budget.signal,
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    budget.abort();
    await expect(read).rejects.toBeInstanceOf(GitHubSourceDeadlineError);
  });

  it("asks again, once, when another caller's deadline ended a read it shared, then counts as out of time", async () => {
    github.endedElsewhere = 1;
    const head = await readGitHubBranchHead({
      ...target,
      branch: "main",
      signal: new AbortController().signal,
    });
    expect(head).toMatchObject({ status: "ok", sha: "c0ffee" });
    expect(requests).toHaveLength(2);

    requests.length = 0;
    github.endedElsewhere = 2;
    await expect(
      readGitHubBranchHead({
        ...target,
        branch: "main",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(GitHubSourceDeadlineError);
    expect(requests).toHaveLength(2);
  });

  it("names a request that never reached GitHub, and leaves a missing connection to the caller", async () => {
    const read = () =>
      readGitHubBlob({
        ...target,
        sha: "b10b",
        signal: new AbortController().signal,
      });
    github.failure = new Error(
      "Provider API request failed (ECONNRESET): GET api.github.com/repos/acme/docs: socket hang up",
    );
    await expect(read()).rejects.toMatchObject({
      name: "GitHubSourceError",
      code: "unavailable",
    });

    const missing = Object.assign(new Error("Connect GitHub."), {
      agentConnectionRequired: true,
    });
    github.failure = missing;
    await expect(read()).rejects.toBe(missing);
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
