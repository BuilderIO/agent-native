import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredential = vi.fn();
const resolveWorkspaceConnectionCredentialForApp = vi.fn();
const readAppSecret = vi.fn();
const isBlockedExtensionUrlWithDns = vi.fn();
const createSsrfSafeDispatcher = vi.fn();
const canUseDeployCredentialFallbackForRequest = vi.fn();
const readDeployCredentialEnv = vi.fn();

vi.mock("../credentials/index.js", () => ({
  resolveCredential,
}));

vi.mock("../workspace-connections/credentials.js", () => ({
  resolveWorkspaceConnectionCredentialForApp,
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret,
}));

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
}));

vi.mock("../oauth-tokens/index.js", () => ({
  deleteOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("../server/credential-provider.js", () => ({
  canUseDeployCredentialFallbackForRequest,
  readDeployCredentialEnv,
}));

const { createGitHubRepoToolEntries } = await import("./github-repo.js");

const ctx = { userEmail: "ada@example.com", orgId: "org-1" };

function githubTools() {
  return createGitHubRepoToolEntries({
    appId: "headless-repo",
    getCredentialContext: () => ctx,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status >= 400 ? "Error" : "OK",
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub repo tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resolveCredential.mockResolvedValue(null);
    resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: false,
    });
    readAppSecret.mockResolvedValue(null);
    isBlockedExtensionUrlWithDns.mockResolvedValue(false);
    createSsrfSafeDispatcher.mockResolvedValue(null);
    canUseDeployCredentialFallbackForRequest.mockReturnValue(false);
    readDeployCredentialEnv.mockReturnValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
  });

  it("marks repository writes and deletes as approval-gated", () => {
    const tools = githubTools();

    expect(tools["github-repo-list-files"].readOnly).toBe(true);
    expect(tools["github-repo-read-file"].readOnly).toBe(true);
    expect(tools["github-repo-search-code"].readOnly).toBe(true);
    expect(tools["github-repo-list-files"].needsApproval).toBeUndefined();
    expect(tools["github-repo-read-file"].needsApproval).toBeUndefined();
    expect(tools["github-repo-search-code"].needsApproval).toBeUndefined();
    expect(tools["github-repo-write-file"].needsApproval).toBe(true);
    expect(tools["github-repo-delete-file"].needsApproval).toBe(true);
  });

  it("lists repository files through the GitHub provider", async () => {
    readAppSecret.mockResolvedValue({ value: "github-secret-token" });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse([
        {
          name: "src",
          path: "src",
          type: "dir",
          sha: "dir-sha",
          html_url: "https://github.com/acme/app/tree/main/src",
        },
      ]),
    );

    const result = await githubTools()["github-repo-list-files"].run({
      repository: "acme/app",
      path: "src",
      ref: "main",
    });

    expect(result).toMatchObject({
      repository: "acme/app",
      path: "src",
      ref: "main",
      total: 1,
      entries: [{ path: "src", type: "dir" }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/app/contents/src?ref=main",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-secret-token",
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("does not fall back to deploy repository for authenticated hosted requests", async () => {
    readDeployCredentialEnv.mockReturnValue("deploy-owner/deploy-repo");

    await expect(
      githubTools()["github-repo-list-files"].run({ path: "" }),
    ).rejects.toThrow(
      'GitHub repository is required. Pass repository="owner/repo" or configure GITHUB_REPOSITORY in setup.',
    );

    expect(readDeployCredentialEnv).not.toHaveBeenCalledWith(
      "GITHUB_REPOSITORY",
    );
  });

  it("reads file content and returns the GitHub SHA", async () => {
    resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: true,
      value: "workspace-token",
      provider: "github",
      key: "GITHUB_TOKEN",
      provenance: {
        resolvedKey: "GITHUB_TOKEN",
        connectionId: "conn-1",
        connectionLabel: "Engineering GitHub",
      },
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        type: "file",
        path: "README.md",
        sha: "file-sha",
        size: 12,
        encoding: "base64",
        content: Buffer.from("# Hello\n", "utf8").toString("base64"),
        html_url: "https://github.com/acme/app/blob/main/README.md",
      }),
    );

    const result = await githubTools()["github-repo-read-file"].run({
      repository: "acme/app",
      path: "README.md",
    });

    expect(result).toMatchObject({
      repository: "acme/app",
      path: "README.md",
      sha: "file-sha",
      content: "# Hello\n",
    });
  });

  it("writes files by loading the current SHA first", async () => {
    readAppSecret.mockResolvedValue({ value: "github-secret-token" });
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          type: "file",
          path: "src/action.ts",
          sha: "old-sha",
          content: "",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          content: {
            path: "src/action.ts",
            sha: "new-sha",
            html_url: "https://github.com/acme/app/blob/main/src/action.ts",
          },
          commit: { sha: "commit-sha" },
        }),
      );

    const result = await githubTools()["github-repo-write-file"].run({
      repository: "acme/app",
      path: "src/action.ts",
      content: "export const value = 1;\n",
      message: "Update action",
      branch: "main",
    });

    expect(result).toMatchObject({
      repository: "acme/app",
      path: "src/action.ts",
      sha: "new-sha",
      commitSha: "commit-sha",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/app/contents/src/action.ts",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          message: "Update action",
          content: Buffer.from("export const value = 1;\n", "utf8").toString(
            "base64",
          ),
          branch: "main",
          sha: "old-sha",
        }),
      }),
    );
  });

  it("deletes files by loading the current SHA first when omitted", async () => {
    readAppSecret.mockResolvedValue({ value: "github-secret-token" });
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          type: "file",
          path: "docs/old.md",
          sha: "old-file-sha",
          content: "",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          content: null,
          commit: { sha: "delete-commit-sha" },
        }),
      );

    const result = await githubTools()["github-repo-delete-file"].run({
      repository: "acme/app",
      path: "docs/old.md",
      message: "Delete docs",
      branch: "cleanup",
    });

    expect(result).toMatchObject({
      repository: "acme/app",
      path: "docs/old.md",
      branch: "cleanup",
      deleted: true,
      commitSha: "delete-commit-sha",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/acme/app/contents/docs/old.md?ref=cleanup",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/app/contents/docs/old.md",
      expect.objectContaining({ method: "DELETE" }),
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      message: "Delete docs",
      sha: "old-file-sha",
      branch: "cleanup",
    });
  });

  it("searches code in the selected repository", async () => {
    readAppSecret.mockResolvedValue({ value: "github-secret-token" });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            name: "action.ts",
            path: "actions/action.ts",
            sha: "match-sha",
            html_url: "https://github.com/acme/app/blob/main/actions/action.ts",
            repository: { full_name: "acme/app" },
          },
        ],
      }),
    );

    const result = await githubTools()["github-repo-search-code"].run({
      repository: "acme/app",
      query: "defineAction",
      path: "actions",
      extension: "ts",
      limit: 5,
    });

    expect(result).toMatchObject({
      repository: "acme/app",
      query: "defineAction",
      totalCount: 1,
      items: [{ path: "actions/action.ts", repository: "acme/app" }],
    });
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain(
      "/search/code?",
    );
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain(
      "repo%3Aacme%2Fapp",
    );
  });

  it("can default the repository from setup", async () => {
    readAppSecret.mockImplementation(async (ref: { key?: string }) =>
      ref.key === "GITHUB_TOKEN"
        ? { value: "github-secret-token" }
        : ref.key === "GITHUB_REPOSITORY"
          ? { value: "acme/default-app" }
          : null,
    );
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        type: "file",
        path: "package.json",
        sha: "pkg-sha",
        content: Buffer.from("{}", "utf8").toString("base64"),
      }),
    );

    const result = await githubTools()["github-repo-read-file"].run({
      path: "package.json",
    });

    expect(result).toMatchObject({
      repository: "acme/default-app",
      path: "package.json",
      content: "{}",
    });
  });
});
