import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  BuilderGitBundleError,
  readBuilderGitBundle,
} from "./builder-branch-git.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "builder-git-bundle-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  await execFile("git", ["init", "--quiet", repo]);
  const git = async (...args: string[]) =>
    execFile("git", ["-C", repo, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  await git("config", "user.name", "Bundle Test");
  await git("config", "user.email", "bundle-test@example.invalid");
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(repo, name);
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.dirname(fullPath), { recursive: true }),
    );
    await writeFile(fullPath, content);
  }
  await git("add", "--all");
  await git("commit", "--quiet", "-m", "fixture");
  const { stdout: sha } = await git("rev-parse", "HEAD");
  const bundlePath = path.join(root, "fixture.bundle");
  await git("bundle", "create", bundlePath, "--all");
  return {
    root,
    sha: sha.trim(),
    bundle: new Uint8Array(await readFile(bundlePath)),
  };
}

describe("readBuilderGitBundle", () => {
  it("reads exact regular-file bytes from the requested app subtree", async () => {
    const { sha, bundle } = await fixture({
      "apps/example/src/index.ts": "export const value = 'ok';\n",
      "apps/other/ignored.txt": "outside target",
    });

    const result = await readBuilderGitBundle({
      bundle,
      commitSha: sha,
      appPath: "apps/example",
    });

    expect(result.commitSha).toBe(sha);
    expect(result.files).toEqual([
      {
        path: "apps/example/src/index.ts",
        mode: "100644",
        content: new TextEncoder().encode("export const value = 'ok';\n"),
      },
    ]);
  });

  it("rejects invalid requests and a commit not advertised by the bundle", async () => {
    const { sha, bundle } = await fixture({ "apps/example/a.txt": "a" });
    await expect(
      readBuilderGitBundle({
        bundle,
        commitSha: "a".repeat(40),
        appPath: "apps/example",
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
    await expect(
      readBuilderGitBundle({
        bundle,
        commitSha: sha,
        appPath: "apps/../example",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects a missing target app and a truncated bundle", async () => {
    const { sha, bundle } = await fixture({ "apps/other/a.txt": "a" });
    await expect(
      readBuilderGitBundle({ bundle, commitSha: sha, appPath: "apps/example" }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
    await expect(
      readBuilderGitBundle({
        bundle: bundle.slice(0, 32),
        commitSha: sha,
        appPath: "apps/example",
      }),
    ).rejects.toBeInstanceOf(BuilderGitBundleError);
  });

  it("checks blob size before reading an oversized blob", async () => {
    const oversized = await fixture({
      "apps/example/oversized.txt": "x".repeat(128 * 1024 + 1),
    });
    await expect(
      readBuilderGitBundle({
        bundle: oversized.bundle,
        commitSha: oversized.sha,
        appPath: "apps/example",
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
  });

  it("rejects symlinks and trees that exceed the file limit", async () => {
    const symlink = await fixture({ "apps/example/regular.txt": "file" });
    const repo = path.join(symlink.root, "repo");
    await execFile("git", [
      "-C",
      repo,
      "-c",
      "user.name=Bundle Test",
      "-c",
      "user.email=bundle-test@example.invalid",
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "symlink-base",
    ]);
    await import("node:fs/promises").then(({ symlink: makeSymlink }) =>
      makeSymlink("regular.txt", path.join(repo, "apps/example/link")),
    );
    await execFile("git", ["-C", repo, "add", "apps/example/link"]);
    await execFile("git", [
      "-C",
      repo,
      "-c",
      "user.name=Bundle Test",
      "-c",
      "user.email=bundle-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "symlink",
    ]);
    const { stdout: symlinkSha } = await execFile("git", [
      "-C",
      repo,
      "rev-parse",
      "HEAD",
    ]);
    const symlinkBundlePath = path.join(symlink.root, "symlink.bundle");
    await execFile("git", [
      "-C",
      repo,
      "bundle",
      "create",
      symlinkBundlePath,
      "--all",
    ]);
    await expect(
      readBuilderGitBundle({
        bundle: new Uint8Array(await readFile(symlinkBundlePath)),
        commitSha: symlinkSha.trim(),
        appPath: "apps/example",
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });

    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [
        `apps/example/${index}.txt`,
        "x",
      ]),
    );
    const largeTree = await fixture(many);
    await expect(
      readBuilderGitBundle({
        bundle: largeTree.bundle,
        commitSha: largeTree.sha,
        appPath: "apps/example",
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
  });
});
