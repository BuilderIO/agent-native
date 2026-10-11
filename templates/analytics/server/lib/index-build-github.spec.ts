import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRequest: vi.fn(),
  listGitHubRepositoryFiles: vi.fn(),
  readGitHubRepositoryFile: vi.fn(),
  compileSourceIndex: vi.fn(),
}));

vi.mock("./provider-api", () => ({
  getAnalyticsProviderApiRuntime: () => ({
    executeRequest: mocks.executeRequest,
    listGitHubRepositoryFiles: mocks.listGitHubRepositoryFiles,
    readGitHubRepositoryFile: mocks.readGitHubRepositoryFile,
  }),
}));

vi.mock("../../scripts/build-source-index", () => ({
  compileSourceIndex: mocks.compileSourceIndex,
}));

const { buildDbtSourceIndexFromGitHub } = await import("./index-build-github");

const SHA = "a".repeat(40);
const REPO = { owner: "acme", repo: "analytics-dbt" };

const validBundle = {
  schemaVersion: 1,
  generatedAt: "2026-10-08T12:00:00.000Z",
  sources: [{ id: "analytics-dbt", contentFingerprint: "b".repeat(64) }],
  entries: [
    {
      id: "model-x",
      metric: "model:x",
      definition: "X model.",
      source: "analytics-dbt",
      sourceKind: "dbt",
    },
  ],
  scanSummary: {
    unsafeEntriesOmitted: 0,
    unsafeFieldsOmitted: 0,
    truncatedFields: 0,
  },
};

function headCommit() {
  return {
    response: {
      ok: true,
      status: 200,
      json: [
        { sha: SHA, commit: { committer: { date: "2026-10-08T12:00:00Z" } } },
      ],
    },
  };
}

function treeEntry(filePath: string) {
  return {
    name: filePath.split("/").pop(),
    path: filePath,
    type: "file",
    sha: "c".repeat(40),
    size: 10,
    url: null,
    htmlUrl: null,
    downloadUrl: null,
  };
}

describe("buildDbtSourceIndexFromGitHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRequest.mockResolvedValue(headCommit());
  });

  it("refuses a truncated tree before fetching or compiling anything", async () => {
    mocks.listGitHubRepositoryFiles.mockResolvedValue({
      entries: [],
      truncated: true,
    });

    await expect(buildDbtSourceIndexFromGitHub(REPO)).rejects.toThrow(
      "no index was built",
    );
    expect(mocks.readGitHubRepositoryFile).not.toHaveBeenCalled();
    expect(mocks.compileSourceIndex).not.toHaveBeenCalled();
  });

  it("fails the whole build when one file cannot be read", async () => {
    mocks.listGitHubRepositoryFiles.mockResolvedValue({
      entries: [treeEntry("models/a.sql"), treeEntry("models/b.sql")],
      truncated: false,
    });
    mocks.readGitHubRepositoryFile.mockImplementation(
      async ({ path: filePath }: { path: string }) => {
        if (filePath === "models/b.sql") {
          throw new Error("GitHub read repository file failed with HTTP 500.");
        }
        return { content: "select 1" };
      },
    );

    await expect(buildDbtSourceIndexFromGitHub(REPO)).rejects.toThrow(
      "HTTP 500",
    );
    expect(mocks.compileSourceIndex).not.toHaveBeenCalled();
  });

  it("compiles only generator inputs, pinned to the head commit, and cleans up", async () => {
    mocks.listGitHubRepositoryFiles.mockResolvedValue({
      entries: [
        treeEntry("models/x.sql"),
        treeEntry("dbt_project.yml"),
        treeEntry("README.md"),
      ],
      truncated: false,
    });
    mocks.readGitHubRepositoryFile.mockImplementation(
      async ({ path: filePath }: { path: string }) => ({
        content: `-- ${filePath}`,
      }),
    );
    let root = "";
    mocks.compileSourceIndex.mockImplementation(
      async ({ dbtRoots }: { dbtRoots: string[] }) => {
        root = dbtRoots[0]!;
        expect(await readFile(path.join(root, "models/x.sql"), "utf8")).toBe(
          "-- models/x.sql",
        );
        return validBundle;
      },
    );

    const { bundle, revision } = await buildDbtSourceIndexFromGitHub(REPO);

    expect(mocks.listGitHubRepositoryFiles).toHaveBeenCalledWith(
      expect.objectContaining({ ref: SHA, recursive: true }),
    );
    expect(mocks.readGitHubRepositoryFile).toHaveBeenCalledTimes(2);
    expect(mocks.compileSourceIndex).toHaveBeenCalledWith({
      dbtRoots: [expect.stringMatching(/\/analytics-dbt$/)],
      generatedAt: "2026-10-08T12:00:00.000Z",
    });
    expect(revision).toBe(SHA);
    expect(bundle.sources[0]).toMatchObject({
      id: "analytics-dbt",
      revision: SHA,
    });
    expect(bundle.entries[0]).toMatchObject({ sourceRevision: SHA });
    expect(existsSync(root)).toBe(false);
  });
});
