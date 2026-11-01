import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

const execFile = promisify(execFileCallback);
const mocks = vi.hoisted(() => ({
  resolveAuthorization: vi.fn(),
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../../../../core/src/server/builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: mocks.resolveAuthorization,
}));
vi.mock("../../../../core/src/server/builder-browser.js", () => ({
  getBuilderApiHost: () => "https://api.builder.example",
}));
vi.mock("../../../../core/src/extensions/url-safety.js", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

import { readBuilderBranchFiles } from "../../../../core/src/server/builder-branch-files.js";
import { CURATED_COMMUNITY_APP_SOURCES } from "./community-apps.js";
import {
  verifyCommunityBranchFiles,
  type CommunityBranchSnapshot,
} from "./community-install-integrity.js";

const ownedRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await Promise.all(
    ownedRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function gitBlobSha(content: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

async function makeBundle(sourceFiles: readonly { path: string }[]) {
  const root = await mkdtemp(
    path.join(tmpdir(), "community-readback-integration-"),
  );
  ownedRoots.push(root);
  const repo = path.join(root, "repo");
  const templateRoot = path.resolve(
    import.meta.dirname,
    "../../../../../templates/community/qr",
  );
  await execFile("git", ["init", "--quiet", repo]);
  const git = (...args: string[]) =>
    execFile("git", ["-C", repo, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  await git("config", "user.name", "Synthetic Readback Test");
  await git("config", "user.email", "readback-test@example.invalid");

  for (const file of sourceFiles) {
    const target = path.join(repo, "apps/verification-qr", file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(templateRoot, file.path), target);
  }
  const outside = path.join(repo, "apps/unrelated/README.md");
  await mkdir(path.dirname(outside), { recursive: true });
  await writeFile(outside, "synthetic unrelated app\n");

  await git("add", "--all");
  await git(
    "commit",
    "--quiet",
    "-m",
    "synthetic reviewed QR readback fixture",
  );
  const { stdout: sha } = await git("rev-parse", "HEAD");
  const bundlePath = path.join(root, "fixture.bundle");
  await git("bundle", "create", bundlePath, "--all");
  const bundle = new Uint8Array(await readFile(bundlePath));
  return { root, bundle, commitSha: sha.trim() };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("community install local readback composition", () => {
  it("verifies a synthetic Git bundle against current QR catalog pins and rejects tampering", async () => {
    const source = CURATED_COMMUNITY_APP_SOURCES.find(
      (candidate) => candidate.id === "community-qr",
    );
    expect(source).toBeDefined();
    if (!source)
      throw new Error("Reviewed QR source is missing from the catalog");

    const { bundle, commitSha } = await makeBundle(source.files);
    const projectId = "synthetic-builder-project";
    const branchName = "community-qr";
    const ownerId = "synthetic-builder-owner";
    const backupAt = Date.now();
    const contentMd5 = createHash("md5").update(bundle).digest("base64");
    const filePath = `${ownerId}/${projectId}/${branchName}/git.bundle`;
    const signedUrl = `https://storage.googleapis.com/builder-projects-git-backups/${filePath}?X-Goog-Signature=synthetic-signature`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const status = {
      status: "ok",
      branch: {
        projectId,
        name: branchName,
        ownerId,
        agentState: "idle",
        hasUnpushedChanges: false,
        lastCommitHash: `code:${commitSha}`,
        lastActivityAt: backupAt - 1,
        deleted: false,
        state: "active",
      },
      backupStatuses: {
        code: {
          state: "valid",
          outcome: "valid",
          backup: {
            projectId,
            ownerId,
            branchName,
            at: backupAt,
            size: bundle.byteLength,
            lastCommitHash: commitSha,
            partial: false,
            status: "completed",
            contentMd5,
            changedSubmodules: [],
          },
        },
      },
    };

    mocks.resolveAuthorization.mockResolvedValue({
      token: "synthetic-token",
      authorization: "Bearer synthetic-token",
      source: "oauth",
    });
    mocks.ssrfSafeFetch.mockResolvedValue(new Response(bundle));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        return url.pathname === "/projects/branch/status"
          ? jsonResponse(status)
          : jsonResponse({
              signedUrl,
              filePath,
              partial: false,
              expiresAt,
            });
      }),
    );

    const snapshot = (await readBuilderBranchFiles({
      projectId,
      branchName,
      appPath: "apps/verification-qr",
    })) as CommunityBranchSnapshot;
    const receipt = verifyCommunityBranchFiles(
      source,
      "verification-qr",
      snapshot,
      { projectId, branchName },
    );

    const pins = new Map(
      source.files.map((file) => [
        `apps/verification-qr/${file.path}`,
        file.blobSha,
      ]),
    );
    expect(receipt).toMatchObject({
      projectId,
      branchName,
      commitSha,
      sourceId: source.id,
      appId: "verification-qr",
      verified: true,
    });
    expect(receipt.files).toHaveLength(source.files.length);
    expect(
      [...receipt.files].sort((a, b) => (a.path < b.path ? -1 : 1)),
    ).toEqual(
      [...pins]
        .map(([filePath, blobSha]) => ({ path: filePath, blobSha }))
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
    expect(
      snapshot.files.every((file) =>
        file.path.startsWith("apps/verification-qr/"),
      ),
    ).toBe(true);

    const tamperedFiles = snapshot.files.map((file, index) => {
      if (index !== 0) return file;
      const content = new Uint8Array(file.content);
      content[0] = content[0]! ^ 1;
      return { ...file, content };
    });
    expect(() =>
      verifyCommunityBranchFiles(
        source,
        "verification-qr",
        { ...snapshot, files: tamperedFiles },
        { projectId, branchName },
      ),
    ).toThrow(expect.objectContaining({ code: "blob_mismatch" }));
  });
});
