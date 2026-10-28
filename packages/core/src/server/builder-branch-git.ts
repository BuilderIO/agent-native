import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  assertBoundedBuilderGitBundle,
  BuilderGitPackError,
} from "./builder-git-pack.js";

const execFile = promisify(execFileCallback);
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 64;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 2 * 1024 * 1024;

export type BuilderGitBundleErrorCode =
  | "invalid_request"
  | "integrity_failed"
  | "unavailable";

export class BuilderGitBundleError extends Error {
  readonly code: BuilderGitBundleErrorCode;

  constructor(code: BuilderGitBundleErrorCode) {
    super(code);
    this.name = "BuilderGitBundleError";
    this.code = code;
  }
}

function fail(code: BuilderGitBundleErrorCode): never {
  throw new BuilderGitBundleError(code);
}

function validateRequest(input: {
  bundle: Uint8Array;
  commitSha: string;
  appPath: string;
}): void {
  if (
    !(input.bundle instanceof Uint8Array) ||
    input.bundle.byteLength === 0 ||
    input.bundle.byteLength > MAX_BUNDLE_BYTES ||
    !/^[0-9a-f]{40}$/.test(input.commitSha) ||
    !/^apps\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.appPath)
  ) {
    fail("invalid_request");
  }
}

async function runGit(cwd: string, args: string[]) {
  try {
    return await execFile(
      "git",
      ["-c", "transfer.unpackLimit=1", "-c", "fetch.unpackLimit=1", ...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: "buffer",
        windowsHide: true,
        env: {
          PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ATTR_NOSYSTEM: "1",
        },
      },
    );
  } catch (error) {
    const details = error as {
      code?: unknown;
      timedOut?: unknown;
    };
    if (
      details.code === "ENOENT" ||
      details.code === "ETIMEDOUT" ||
      details.timedOut === true
    ) {
      fail("unavailable");
    }
    fail("integrity_failed");
  }
}

export async function readBuilderGitBundle(input: {
  bundle: Uint8Array;
  commitSha: string;
  appPath: string;
}): Promise<{
  commitSha: string;
  files: Array<{ path: string; mode: string; content: Uint8Array }>;
}> {
  validateRequest(input);
  let root: string | undefined;
  try {
    assertBoundedBuilderGitBundle(input.bundle);
    root = await mkdtemp(path.join(tmpdir(), "builder-git-bundle-"));
    const repo = path.join(root, "repo.git");
    const bundlePath = path.join(root, "input.bundle");
    await writeFile(bundlePath, input.bundle);
    await runGit(root, ["init", "--bare", "--quiet", repo]);

    const verification = await runGit(repo, ["bundle", "verify", bundlePath]);
    if (verification.stdout.length > GIT_MAX_BUFFER) fail("integrity_failed");
    const heads = await runGit(repo, ["bundle", "list-heads", bundlePath]);
    const headLines = heads.stdout.toString("utf8").trim().split(/\r?\n/);
    const advertised = headLines
      .filter(Boolean)
      .map((line) => /^([0-9a-f]{40})\s+\S+$/.exec(line)?.[1]);
    if (
      advertised.length === 0 ||
      advertised.some((sha) => !sha) ||
      !advertised.includes(input.commitSha)
    ) {
      fail("integrity_failed");
    }

    await runGit(repo, ["fetch", "--no-tags", bundlePath, input.commitSha]);
    const tree = await runGit(repo, [
      "ls-tree",
      "-rz",
      "--full-tree",
      input.commitSha,
      "--",
      input.appPath,
    ]);
    if (tree.stdout.length > GIT_MAX_BUFFER) fail("integrity_failed");
    let treeText: string;
    try {
      treeText = new TextDecoder("utf-8", { fatal: true }).decode(tree.stdout);
    } catch {
      fail("integrity_failed");
    }
    const records = treeText.split("\0").filter(Boolean);
    if (records.length === 0 || records.length > MAX_FILES)
      fail("integrity_failed");

    const files: Array<{ path: string; mode: string; content: Uint8Array }> =
      [];
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const record of records) {
      const match = /^(\d{6}) blob ([0-9a-f]{40})\t(.+)$/.exec(record);
      if (!match) fail("integrity_failed");
      const mode = match[1];
      const blobSha = match[2];
      const filePath = match[3];
      if (mode !== "100644" || !blobSha || !filePath) fail("integrity_failed");
      if (
        !filePath.startsWith(`${input.appPath}/`) ||
        filePath.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(filePath) ||
        filePath.includes("\\") ||
        filePath
          .split("/")
          .some((part) => !part || part === "." || part === "..") ||
        seen.has(filePath)
      ) {
        fail("integrity_failed");
      }
      seen.add(filePath);
      const sizeResult = await runGit(repo, ["cat-file", "-s", blobSha]);
      const sizeText = sizeResult.stdout.toString("ascii").trim();
      if (!/^\d+$/.test(sizeText)) fail("integrity_failed");
      const expectedSize = Number(sizeText);
      if (
        !Number.isSafeInteger(expectedSize) ||
        expectedSize > MAX_FILE_BYTES
      ) {
        fail("integrity_failed");
      }
      const blob = await runGit(repo, ["cat-file", "blob", blobSha]);
      const content = new Uint8Array(blob.stdout);
      const actualSha = createHash("sha1")
        .update(`blob ${content.byteLength}\0`)
        .update(content)
        .digest("hex");
      if (actualSha !== blobSha || content.byteLength !== expectedSize) {
        fail("integrity_failed");
      }
      totalBytes += content.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) fail("integrity_failed");
      files.push({ path: filePath, mode, content });
    }
    return { commitSha: input.commitSha, files };
  } catch (error) {
    if (error instanceof BuilderGitBundleError) throw error;
    if (error instanceof BuilderGitPackError) return fail("integrity_failed");
    return fail("unavailable");
  } finally {
    if (root) {
      try {
        await rm(root, { recursive: true, force: true });
      } catch {
        fail("unavailable");
      }
    }
  }
}
