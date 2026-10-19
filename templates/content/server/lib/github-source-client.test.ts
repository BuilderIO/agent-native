import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => [] as Array<{ path: string }>);
vi.mock("./provider-api.js", () => ({
  executeGitHubSourceRequest: async (args: { path: string }) => {
    requests.push(args);
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
  GitHubSourceError,
  readGitHubBranchHead,
  readGitHubFolderTree,
} from "./github-source-client";

const target = { owner: "acme", repo: "site" };

beforeEach(() => {
  requests.length = 0;
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
