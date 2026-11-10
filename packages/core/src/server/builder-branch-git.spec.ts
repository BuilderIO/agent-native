import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

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

async function emptyTreeDagBundle(
  fanout: number,
  oversizedTree: "app" | "root" | "apps" = "app",
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "builder-git-empty-tree-test-"),
  );
  roots.push(root);
  const repo = path.join(root, "repo");
  await execFile("git", ["init", "--quiet", repo]);
  const git = (...args: string[]) => execFile("git", ["-C", repo, ...args]);
  const hashObject = async (
    name: string,
    content: Uint8Array,
    type: "blob" | "tree" = "tree",
  ) => {
    const filename = path.join(root, name);
    await writeFile(filename, content);
    const { stdout } = await git("hash-object", "-w", "-t", type, filename);
    return stdout.trim();
  };
  const hashTree = (name: string, content: Uint8Array) =>
    hashObject(name, content, "tree");

  const emptyTreeOid = await hashTree("empty-tree", new Uint8Array());
  const fileBlobOid = await hashObject("file-blob", Buffer.from("ok"), "blob");
  const repeatedTreeEntries = Array.from({ length: fanout }, (_, index) =>
    Buffer.concat([
      Buffer.from(`40000 child-${index.toString().padStart(4, "0")}\0`),
      Buffer.from(emptyTreeOid, "hex"),
    ]),
  );
  const appTreeOid = await hashTree(
    "app-tree",
    Buffer.concat(
      oversizedTree === "app"
        ? repeatedTreeEntries
        : [Buffer.from("100644 file.txt\0"), Buffer.from(fileBlobOid, "hex")],
    ),
  );
  const appsTreeOid = await hashTree(
    "apps-tree",
    Buffer.concat([
      ...(oversizedTree === "apps" ? repeatedTreeEntries : []),
      Buffer.from("40000 example\0"),
      Buffer.from(appTreeOid, "hex"),
    ]),
  );
  const rootTreeOid = await hashTree(
    "root-tree",
    Buffer.concat([
      Buffer.from("40000 apps\0"),
      Buffer.from(appsTreeOid, "hex"),
      ...(oversizedTree === "root" ? repeatedTreeEntries : []),
    ]),
  );
  const commitPath = path.join(root, "commit");
  await writeFile(
    commitPath,
    `tree ${rootTreeOid}\nauthor Test <test@example.invalid> 1 +0000\ncommitter Test <test@example.invalid> 1 +0000\n\nempty tree DAG fixture\n`,
  );
  const { stdout: commitSha } = await git(
    "hash-object",
    "-w",
    "-t",
    "commit",
    commitPath,
  );
  await git("update-ref", "refs/heads/main", commitSha.trim());
  const bundlePath = path.join(root, "empty-tree.bundle");
  await git("bundle", "create", bundlePath, "--all");
  return {
    commitSha: commitSha.trim(),
    bundle: new Uint8Array(await readFile(bundlePath)),
  };
}

async function deltaBundle() {
  const root = await mkdtemp(path.join(tmpdir(), "builder-git-delta-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  await execFile("git", ["init", "--quiet", repo]);
  const git = (...args: string[]) =>
    execFile("git", ["-C", repo, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  await git("config", "user.name", "Bundle Test");
  await git("config", "user.email", "bundle-test@example.invalid");
  const lines = Array.from(
    { length: 1800 },
    (_, index) =>
      `row-${index.toString().padStart(4, "0")}:${"x".repeat(20)}\n`,
  );
  const contentPath = path.join(repo, "apps/example/data.txt");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(path.dirname(contentPath), { recursive: true }),
  );
  for (let revision = 0; revision < 24; revision++) {
    lines[revision] =
      `row-${revision.toString().padStart(4, "0")}:revision-${revision}\n`;
    await writeFile(contentPath, lines.join(""));
    await git("add", "apps/example/data.txt");
    await git(
      "-c",
      "user.name=Bundle Test",
      "-c",
      "user.email=bundle-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      `revision ${revision}`,
    );
  }
  await git("gc", "--aggressive", "--prune=now");
  const { stdout: sha } = await git("rev-parse", "HEAD");
  const bundlePath = path.join(root, "delta.bundle");
  await git("bundle", "create", bundlePath, "--all");
  return {
    commitSha: sha.trim(),
    bundle: new Uint8Array(await readFile(bundlePath)),
    expectedContent: new TextEncoder().encode(lines.join("")),
  };
}

function bundleContainsDelta(bundle: Uint8Array): boolean {
  const bytes = Buffer.from(
    bundle.buffer,
    bundle.byteOffset,
    bundle.byteLength,
  );
  const headerEnd = bytes.indexOf("\n\n");
  if (headerEnd < 0) return false;
  const packOffset = headerEnd + 2;
  const packEnd = bytes.byteLength - 20;
  const objectCount = bytes.readUInt32BE(packOffset + 8);
  let cursor = packOffset + 12;
  let containsDelta = false;
  const readByte = () => {
    const value = bytes[cursor];
    if (value === undefined) throw new Error("Malformed test pack fixture");
    cursor++;
    return value;
  };
  for (let index = 0; index < objectCount; index++) {
    const first = readByte();
    const type = (first >>> 4) & 7;
    let continuation = (first & 0x80) !== 0;
    while (continuation) {
      const next = readByte();
      continuation = (next & 0x80) !== 0;
    }
    if (type === 6) {
      containsDelta = true;
      let next = readByte();
      while (next & 0x80) next = readByte();
    } else if (type === 7) {
      containsDelta = true;
      cursor += 20;
    }
    const inflated = inflateSync(bytes.subarray(cursor, packEnd), {
      info: true,
    }) as unknown as { engine: { bytesWritten: number } };
    cursor += inflated.engine.bytesWritten;
  }
  return containsDelta;
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

  it("reads a multi-file pack only once after indexing", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `apps/example/${index}.txt`,
        `file ${index}`,
      ]),
    );
    const { sha, bundle } = await fixture(files);
    const readFileSpy = vi.spyOn(fs.promises, "readFile");

    try {
      const result = await readBuilderGitBundle({
        bundle,
        commitSha: sha,
        appPath: "apps/example",
      });

      expect(result.files).toHaveLength(12);
      expect(
        readFileSpy.mock.calls.filter(([filename]) =>
          String(filename).endsWith(".pack"),
        ),
      ).toHaveLength(2);
    } finally {
      readFileSpy.mockRestore();
    }
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
    ).rejects.toMatchObject({ code: "target_missing" });
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

  it("rejects broad repeated empty-tree DAGs", async () => {
    const { commitSha, bundle } = await emptyTreeDagBundle(1025);

    await expect(
      readBuilderGitBundle({ bundle, commitSha, appPath: "apps/example" }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
  });

  it("bounds root and apps trees before parsing them", async () => {
    for (const oversizedTree of ["root", "apps"] as const) {
      const { commitSha, bundle } = await emptyTreeDagBundle(
        1024,
        oversizedTree,
      );

      await expect(
        readBuilderGitBundle({ bundle, commitSha, appPath: "apps/example" }),
      ).rejects.toMatchObject({ code: "integrity_failed" });
    }
  });

  it("reads files from a real delta-compressed Git bundle", async () => {
    const { bundle, commitSha, expectedContent } = await deltaBundle();
    expect(bundleContainsDelta(bundle)).toBe(true);

    const result = await readBuilderGitBundle({
      bundle,
      commitSha,
      appPath: "apps/example",
    });

    expect(result.files).toEqual([
      {
        path: "apps/example/data.txt",
        mode: "100644",
        content: expectedContent,
      },
    ]);
  });
});
