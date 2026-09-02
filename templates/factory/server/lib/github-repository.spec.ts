import { describe, expect, it } from "vitest";

import {
  canonicalGitHubRepository,
  gitHubRepositoriesEqual,
  parseGitHubRepositoryRef,
  persistGitHubRepository,
} from "./github-repository.js";

describe("parseGitHubRepositoryRef", () => {
  it("accepts owner/repo, trailing slashes, and .git", () => {
    expect(parseGitHubRepositoryRef("BuilderIO/agent-native/")).toEqual({
      owner: "BuilderIO",
      repo: "agent-native",
    });
    expect(parseGitHubRepositoryRef("BuilderIO/agent-native.git")).toEqual({
      owner: "BuilderIO",
      repo: "agent-native",
    });
  });

  it("accepts github.com URLs and strips extra path", () => {
    expect(
      canonicalGitHubRepository("https://github.com/BuilderIO/agent-native/"),
    ).toBe("BuilderIO/agent-native");
    expect(
      canonicalGitHubRepository(
        "https://www.github.com/BuilderIO/agent-native.git",
      ),
    ).toBe("BuilderIO/agent-native");
    expect(
      canonicalGitHubRepository("github.com/BuilderIO/agent-native/pull/123"),
    ).toBe("BuilderIO/agent-native");
    expect(
      canonicalGitHubRepository("git@github.com:BuilderIO/agent-native.git"),
    ).toBe("BuilderIO/agent-native");
    expect(
      canonicalGitHubRepository(
        "git@github.com:BuilderIO/agent-native.git/pull/123",
      ),
    ).toBe("BuilderIO/agent-native");
  });

  it("rejects non-GitHub hosts and incomplete refs", () => {
    expect(() =>
      parseGitHubRepositoryRef("https://gitlab.com/BuilderIO/agent-native"),
    ).toThrow(/GitHub URL or owner\/repository/);
    expect(() => parseGitHubRepositoryRef("BuilderIO")).toThrow(
      /GitHub URL or owner\/repository/,
    );
    expect(() =>
      parseGitHubRepositoryRef("https://github.com/orgs/BuilderIO"),
    ).toThrow(/GitHub URL or owner\/repository/);
  });
});

describe("persistGitHubRepository", () => {
  it("stores canonical owner/repo and treats blank as absent", () => {
    expect(
      persistGitHubRepository("https://github.com/BuilderIO/agent-native/"),
    ).toBe("BuilderIO/agent-native");
    expect(persistGitHubRepository("  ")).toBeNull();
    expect(persistGitHubRepository(null)).toBeNull();
  });
});

describe("gitHubRepositoriesEqual", () => {
  it("compares canonical forms so a trailing slash still matches", () => {
    expect(
      gitHubRepositoriesEqual(
        "BuilderIO/agent-native/",
        "https://github.com/BuilderIO/agent-native",
      ),
    ).toBe(true);
    expect(
      gitHubRepositoriesEqual("BuilderIO/agent-native", "BuilderIO/other"),
    ).toBe(false);
  });
});
